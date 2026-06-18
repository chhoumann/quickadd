import { afterEach, describe, expect, it, vi } from "vitest";
import { TFile, type App } from "obsidian";
import {
	appendFrontmatterPropertyLinkValue,
	appendLinkToFrontmatterProperty,
	getFocusedPropertyTarget,
	type FrontmatterPropertyTarget,
} from "./frontmatterPropertyLinks";

afterEach(() => {
	document.body.innerHTML = "";
	vi.restoreAllMocks();
});

function makeFile(path: string): TFile {
	const file = new TFile();
	file.path = path;
	file.name = path.split("/").pop() ?? path;
	file.basename = file.name.replace(/\.md$/i, "");
	file.extension = "md";
	return file;
}

function createPropertyRow(options: {
	key: string;
	focus: "value" | "key" | "none";
	valueType?: string;
}) {
	const container = document.createElement("div");
	const row = document.createElement("div");
	row.className = "metadata-property";
	row.setAttribute("data-property-key", options.key);

	const keyCell = document.createElement("div");
	keyCell.className = "metadata-property-key";
	const keyInput = document.createElement("input");
	keyInput.className = "metadata-property-key-input";
	keyCell.appendChild(keyInput);

	const valueCell = document.createElement("div");
	valueCell.className = "metadata-property-value";
	const valueInput = options.valueType
		? document.createElement("input")
		: document.createElement("div");
	if (options.valueType) {
		(valueInput as HTMLInputElement).type = options.valueType;
	} else {
		valueInput.className = "metadata-input-longtext";
		valueInput.setAttribute("contenteditable", "true");
		valueInput.tabIndex = 0;
	}
	valueCell.appendChild(valueInput);

	row.append(keyCell, valueCell);
	container.appendChild(row);
	document.body.appendChild(container);

	if (options.focus === "value") valueInput.focus();
	if (options.focus === "key") keyInput.focus();

	return { container, keyInput, valueInput };
}

function makeAppWithLeaves(
	leaves: Array<{ containerEl: HTMLElement; file: TFile }>,
): App {
	return {
		workspace: {
			getLeavesOfType: (type: string) =>
				type === "markdown"
					? leaves.map((view) => ({ view }))
					: [],
		},
	} as unknown as App;
}

describe("getFocusedPropertyTarget", () => {
	it("returns the focused property value key and owning file", () => {
		const file = makeFile("Host.md");
		const { container } = createPropertyRow({
			key: "related",
			focus: "value",
		});

		expect(getFocusedPropertyTarget(makeAppWithLeaves([{ containerEl: container, file }]))).toEqual<FrontmatterPropertyTarget>({
			file,
			key: "related",
		});
	});

	it("binds the target to the markdown view that owns the focused property", () => {
		const first = createPropertyRow({ key: "related", focus: "none" });
		const second = createPropertyRow({ key: "related", focus: "value" });
		const firstFile = makeFile("First.md");
		const secondFile = makeFile("Second.md");

		expect(
			getFocusedPropertyTarget(
				makeAppWithLeaves([
					{ containerEl: first.container, file: firstFile },
					{ containerEl: second.container, file: secondFile },
				]),
			),
		).toEqual({ file: secondFile, key: "related" });
	});

	it("returns null when focus is in the property key", () => {
		const file = makeFile("Host.md");
		const { container } = createPropertyRow({
			key: "related",
			focus: "key",
		});

		expect(getFocusedPropertyTarget(makeAppWithLeaves([{ containerEl: container, file }]))).toBeNull();
	});

	it.each(["number", "date", "datetime-local", "time", "month", "checkbox"])(
		"returns null for typed property input %s",
		(valueType) => {
			const file = makeFile("Host.md");
			const { container } = createPropertyRow({
				key: "related",
				focus: "value",
				valueType,
			});

			expect(getFocusedPropertyTarget(makeAppWithLeaves([{ containerEl: container, file }]))).toBeNull();
		},
	);

	it("returns null when no property value is focused", () => {
		const file = makeFile("Host.md");
		const { container } = createPropertyRow({
			key: "related",
			focus: "none",
		});
		const input = document.createElement("input");
		document.body.appendChild(input);
		input.focus();

		expect(getFocusedPropertyTarget(makeAppWithLeaves([{ containerEl: container, file }]))).toBeNull();
	});
});

describe("appendFrontmatterPropertyLinkValue", () => {
	it("pushes links into list properties", () => {
		const frontmatter = { related: ["[[Existing]]"] };

		appendFrontmatterPropertyLinkValue(frontmatter, "related", "[[Created]]");

		expect(frontmatter.related).toEqual(["[[Existing]]", "[[Created]]"]);
	});

	it("appends links to string properties", () => {
		const frontmatter = { related: "existing" };

		appendFrontmatterPropertyLinkValue(frontmatter, "related", "[[Created]]");

		expect(frontmatter.related).toBe("existing [[Created]]");
	});

	it("sets missing, null, and empty properties to the link", () => {
		const frontmatter: Record<string, unknown> = {
			nullish: null,
			empty: "",
		};

		appendFrontmatterPropertyLinkValue(frontmatter, "missing", "[[Created]]");
		appendFrontmatterPropertyLinkValue(frontmatter, "nullish", "[[Created]]");
		appendFrontmatterPropertyLinkValue(frontmatter, "empty", "[[Created]]");

		expect(frontmatter.missing).toBe("[[Created]]");
		expect(frontmatter.nullish).toBe("[[Created]]");
		expect(frontmatter.empty).toBe("[[Created]]");
	});

	it("rejects object and non-string scalar values instead of coercing property types", () => {
		expect(() =>
			appendFrontmatterPropertyLinkValue({ related: { nested: true } }, "related", "[[Created]]"),
		).toThrow(/object value/);
		expect(() =>
			appendFrontmatterPropertyLinkValue({ related: 5 }, "related", "[[Created]]"),
		).toThrow(/number value/);
	});

	it("rejects empty property keys", () => {
		expect(() =>
			appendFrontmatterPropertyLinkValue({}, "   ", "[[Created]]"),
		).toThrow(/empty frontmatter property key/);
	});
});

describe("appendLinkToFrontmatterProperty", () => {
	it("uses the focused property's file as the markdown link source", async () => {
		const targetFile = makeFile("Folder/Host.md");
		const createdFile = makeFile("Folder/Sub/Created.md");
		const target: FrontmatterPropertyTarget = {
			file: targetFile,
			key: "related",
		};
		const frontmatter: Record<string, unknown> = { related: "existing" };
		const generateMarkdownLink = vi.fn(() => "[[Sub/Created|Created]]");
		const processFrontMatter = vi.fn(
			async (_file: TFile, update: (fm: Record<string, unknown>) => void) => {
				update(frontmatter);
			},
		);
		const app = {
			fileManager: {
				generateMarkdownLink,
				processFrontMatter,
			},
		} as unknown as App;

		await expect(
			appendLinkToFrontmatterProperty(app, target, createdFile),
		).resolves.toBe(true);

		expect(generateMarkdownLink).toHaveBeenCalledWith(
			createdFile,
			"Folder/Host.md",
		);
		expect(processFrontMatter).toHaveBeenCalledWith(
			targetFile,
			expect.any(Function),
		);
		expect(frontmatter.related).toBe("existing [[Sub/Created|Created]]");
	});

	it("reports failure without throwing when frontmatter persistence fails", async () => {
		const targetFile = makeFile("Host.md");
		const createdFile = makeFile("Created.md");
		const app = {
			fileManager: {
				generateMarkdownLink: vi.fn(() => "[[Created]]"),
				processFrontMatter: vi.fn(async () => {
					throw new Error("write failed");
				}),
			},
		} as unknown as App;

		await expect(
			appendLinkToFrontmatterProperty(
				app,
				{ file: targetFile, key: "related" },
				createdFile,
			),
		).resolves.toBe(false);
	});
});
