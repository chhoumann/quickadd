import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownView, TFile, type App } from "obsidian";
import { createChoiceExecutor } from "../../tests/helpers/createChoiceExecutor";
import type QuickAdd from "../main";
import { CaptureChoiceFormatter } from "./captureChoiceFormatter";

const { prompt } = vi.hoisted(() => ({
	prompt: vi.fn<() => Promise<string>>(),
}));

vi.mock("../gui/InputPrompt", () => ({
	default: class {
		factory() {
			return { Prompt: prompt, PromptWithContext: prompt };
		}
	},
}));
vi.mock("obsidian-dataview", () => ({ getAPI: () => null }));
vi.mock("../main", async () =>
	(await import("../../tests/helpers/formatters/mocks")).mainMock(),
);
vi.mock("../logger/logManager", async () =>
	(await import("../../tests/helpers/formatters/mocks")).logManagerMock(),
);

const tfile = (path: string) =>
	Object.assign(new TFile(), {
		path,
		name: path.split("/").pop(),
		basename: (path.split("/").pop() ?? path).replace(/\.\w+$/, ""),
		extension: path.split(".").pop(),
	});

/** A Capture whose format includes `Include.md`, the way `{{TEMPLATE:Include.md}}` renders it in Obsidian. */
function makeCapture(include: string, { selection = "" } = {}) {
	const files = new Map([
		["Include.md", tfile("Include.md")],
		["People/Ann.md", tfile("People/Ann.md")],
	]);
	const editorView = Object.assign(Object.create(MarkdownView.prototype), {
		editor: { getSelection: () => selection },
	});
	const app = {
		workspace: {
			getActiveFile: () => tfile("Journal/Today.md"),
			getActiveViewOfType: () => editorView,
		},
		vault: {
			getAbstractFileByPath: (path: string) => files.get(path) ?? null,
			cachedRead: async () => include,
			createBinary: async (path: string) => tfile(path),
		},
		metadataCache: { getFileCache: () => null, getAllPropertyInfos: () => ({}) },
		fileManager: {
			generateMarkdownLink: (file: TFile, sourcePath: string) =>
				`[[${file.path}]] from '${sourcePath}'`,
			getAvailablePathForAttachment: async () => "Assets/clip.png",
		},
		plugins: { plugins: {} },
	} as unknown as App;
	const plugin = {
		settings: {
			globalVariables: {},
			choices: [],
			inputPrompt: "single-line",
			enableTemplatePropertyTypes: false,
		},
	} as unknown as QuickAdd;
	const executor = createChoiceExecutor();
	const formatter = new CaptureChoiceFormatter(app, plugin, executor);
	formatter.setDestinationSourcePath("Inbox/Target.md");
	return { formatter, executor };
}

describe("a template included in a Capture format writes like the Capture format itself", () => {
	beforeEach(() => {
		prompt.mockReset();
		Object.defineProperty(globalThis, "navigator", {
			configurable: true,
			value: { clipboard: { readText: async () => "" } },
		});
	});

	it("adds each |multi pick as its own list item", async () => {
		const { formatter, executor } = makeCapture(
			"{{VALUE:business,pricing,marketing|multi}}\nto-read",
		);
		executor.variables.set("business,pricing,marketing", ["business", "pricing"]);

		expect(await formatter.formatPropertyValue("{{TEMPLATE:Include.md}}", { listItems: true }))
			.toBe("business\npricing\nto-read");
	});

	it("leaves {{PROPERTY}} to the Capture, so the list is composed in the included order", async () => {
		const { formatter, executor } = makeCapture("first\n{{PROPERTY}}");
		executor.variables.set("propertyValue", ["a", "b"]);

		expect(await formatter.formatPropertyValue("{{TEMPLATE:Include.md}}", { listItems: true }))
			.toBe("first\na\nb");
		expect(formatter.consumePropertyTokenExpanded()).toBe(true);
	});

	it("follows the Capture's selection setting for {{VALUE}}", async () => {
		const ignoring = makeCapture("B={{VALUE}}", { selection: "selected words" });
		ignoring.formatter.setUseSelectionAsCaptureValue(false);
		prompt.mockResolvedValueOnce("typed");
		expect(await ignoring.formatter.formatContentOnly("{{TEMPLATE:Include.md}}")).toBe("B=typed");

		const using = makeCapture("B={{VALUE}}", { selection: "selected words" });
		expect(await using.formatter.formatContentOnly("{{TEMPLATE:Include.md}}")).toBe("B=selected words");
		expect(prompt).toHaveBeenCalledTimes(1);
	});

	it("writes links relative to the Capture's destination", async () => {
		const { formatter, executor } = makeCapture("{{LINKCURRENT}} with {{FILE:People|link}}");
		executor.variables.set("FILE:folder=People|mode=link", "@file:People/Ann.md");

		expect(await formatter.formatContentOnly("{{TEMPLATE:Include.md}}")).toBe(
			"[[Journal/Today.md]] from 'Inbox/Target.md' with [[People/Ann.md]] from 'Inbox/Target.md'",
		);
	});

	it("saves a copied image for {{CLIPBOARD}}, like the Capture format does", async () => {
		const { formatter } = makeCapture("{{CLIPBOARD}}");
		const image = { types: ["image/png"], getType: async () => new Blob(["png"]) };
		Object.defineProperty(globalThis, "navigator", {
			configurable: true,
			value: { clipboard: { readText: async () => "", read: async () => [image] } },
		});

		expect(await formatter.formatContentOnly("{{TEMPLATE:Include.md}}"))
			.toBe("![[Assets/clip.png]] from 'Inbox/Target.md'");
		expect(formatter.consumeCreatedClipboardAttachmentPaths()).toEqual(["Assets/clip.png"]);
	});
});
