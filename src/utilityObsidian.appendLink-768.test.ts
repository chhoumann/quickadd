import { MarkdownView, TFile, type App } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	appendLinkToFrontmatterProperty,
	getFocusedPropertyTarget,
	type FrontmatterPropertyTarget,
} from "./utilityObsidian";
import type { AppendLinkOptions } from "./types/linkPlacement";

/**
 * Regression tests for #768. The link must follow the caret into a frontmatter
 * property. Detection reads which property is focused (popout-aware, value side
 * only) and persistence goes through processFrontMatter — verified live in a
 * real Obsidian vault; see PR notes.
 */

afterEach(() => {
	document.body.innerHTML = "";
	vi.restoreAllMocks();
});

function makeFile(path: string): TFile {
	const file = new TFile();
	file.path = path;
	file.basename = path.replace(/\.md$/, "");
	return file;
}

/** Mounts a Markdown view container with one property row and returns its app. */
function mountViewWithProperty(opts: {
	key: string;
	/** Which sub-cell to focus: the value editor or the key input. */
	focus: "value" | "key" | "none";
	file: TFile;
	/** Input `type` for the value field (e.g. "number"); default text-like. */
	valueType?: string;
}) {
	const container = document.createElement("div");
	const propertiesEl = document.createElement("div");
	propertiesEl.className = "metadata-properties";
	const row = document.createElement("div");
	row.className = "metadata-property";
	row.setAttribute("data-property-key", opts.key);

	const keyInput = document.createElement("input");
	keyInput.className = "metadata-property-key-input";
	const keyCell = document.createElement("div");
	keyCell.className = "metadata-property-key";
	keyCell.appendChild(keyInput);

	const valueCell = document.createElement("div");
	valueCell.className = "metadata-property-value";
	const valueInput = document.createElement("input");
	if (opts.valueType) valueInput.type = opts.valueType;
	valueCell.appendChild(valueInput);

	row.append(keyCell, valueCell);
	propertiesEl.appendChild(row);
	container.appendChild(propertiesEl);
	document.body.appendChild(container);

	if (opts.focus === "value") valueInput.focus();
	else if (opts.focus === "key") keyInput.focus();

	const view = Object.create(MarkdownView.prototype) as MarkdownView;
	(view as unknown as { containerEl: HTMLElement }).containerEl = container;
	(view as unknown as { file: TFile }).file = opts.file;
	const leaf = { view };

	const app = {
		workspace: { getLeavesOfType: (type: string) => (type === "markdown" ? [leaf] : []) },
	} as unknown as App;
	return { app, valueInput, keyInput };
}

describe("getFocusedPropertyTarget", () => {
	it("returns the focused property's key and owning file", () => {
		const file = makeFile("Note.md");
		const { app } = mountViewWithProperty({ key: "authors", focus: "value", file });
		expect(getFocusedPropertyTarget(app)).toEqual<FrontmatterPropertyTarget>({
			file,
			key: "authors",
		});
	});

	it("returns null when the caret is in the property KEY field (not the value)", () => {
		const file = makeFile("Note.md");
		const { app } = mountViewWithProperty({ key: "authors", focus: "key", file });
		expect(getFocusedPropertyTarget(app)).toBeNull();
	});

	it("returns null for typed inputs (number/date) so they fall back to body", () => {
		const file = makeFile("Note.md");
		const { app } = mountViewWithProperty({
			key: "count",
			focus: "value",
			file,
			valueType: "number",
		});
		expect(getFocusedPropertyTarget(app)).toBeNull();
	});

	it("returns null when no property is focused", () => {
		const file = makeFile("Note.md");
		const { app } = mountViewWithProperty({ key: "authors", focus: "none", file });
		expect(getFocusedPropertyTarget(app)).toBeNull();
	});

	it("returns null when the focused element is outside any markdown view", () => {
		const file = makeFile("Note.md");
		const { app } = mountViewWithProperty({ key: "authors", focus: "none", file });
		const stray = document.createElement("input");
		document.body.appendChild(stray);
		stray.focus();
		expect(getFocusedPropertyTarget(app)).toBeNull();
	});
});

describe("appendLinkToFrontmatterProperty", () => {
	const target: FrontmatterPropertyTarget = { file: makeFile("Note.md"), key: "links" };
	const linkOptions: AppendLinkOptions = {
		enabled: true,
		placement: "replaceSelection",
		requireActiveFile: true,
		linkType: "link",
	};

	/** Runs the helper against an initial frontmatter object and returns the mutated value. */
	async function runWith(initial: Record<string, unknown>, options = linkOptions) {
		const frontmatter = { ...initial };
		const app = {
			fileManager: {
				generateMarkdownLink: (file: TFile) => `[[${file.basename}]]`,
				processFrontMatter: async (
					_file: TFile,
					fn: (fm: Record<string, unknown>) => void,
				) => fn(frontmatter),
			},
		} as unknown as App;
		await appendLinkToFrontmatterProperty(app, target, makeFile("Created.md"), options);
		return frontmatter.links;
	}

	it("pushes a new item onto a list property", async () => {
		expect(await runWith({ links: ["[[A]]"] })).toEqual(["[[A]]", "[[Created]]"]);
	});

	it("appends to a non-empty scalar without destroying it", async () => {
		expect(await runWith({ links: "[[A]]" })).toBe("[[A]] [[Created]]");
	});

	it("sets an empty or missing property to the link", async () => {
		expect(await runWith({ links: "" })).toBe("[[Created]]");
		expect(await runWith({})).toBe("[[Created]]");
	});

	it("preserves a number value as a string instead of wiping it", async () => {
		expect(await runWith({ links: 5 })).toBe("5 [[Created]]");
	});

	it("embeds when linkType is embed and placement supports it", async () => {
		const embedded = await runWith(
			{ links: "" },
			{ ...linkOptions, linkType: "embed" },
		);
		expect(embedded).toBe("![[Created]]");
	});
});
