import realMoment from "moment";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownView, TFile, type App } from "obsidian";
import { createChoiceExecutor } from "../../tests/helpers/createChoiceExecutor";
import type QuickAdd from "../main";
import { CaptureChoiceFormatter } from "./captureChoiceFormatter";

const { prompt, datePrompt } = vi.hoisted(() => ({
	prompt: vi.fn<() => Promise<string>>(),
	datePrompt: vi.fn<(app: unknown, header: string) => Promise<string>>(),
}));

vi.mock("../gui/InputPrompt", () => ({
	default: class {
		factory() {
			return { Prompt: prompt };
		}
	},
}));
vi.mock("../gui/VDateInputPrompt/VDateInputPrompt", () => ({
	default: { Prompt: datePrompt },
}));
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
function makeCapture(include: string, { selection = "", globalVariables = {} } = {}) {
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
			globalVariables,
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

describe("an included template reuses a date of the Capture format (#1950)", () => {
	const format = "- {{VALUE|label:What happened?}} 📅 {{VDATE:due,DD.MM.YYYY|label:When is it due?}}\n{{TEMPLATE:Include.md}}";
	const stubMoment = (globalThis as { window: { moment: unknown } }).window.moment;

	beforeEach(() => {
		prompt.mockReset();
		datePrompt.mockReset();
		(globalThis as { window: { moment: unknown } }).window.moment = (input?: string) => realMoment.utc(input);
	});
	afterEach(() => {
		(globalThis as { window: { moment: unknown } }).window.moment = stubMoment;
	});

	it("asks the VDATE's date prompt for the include's {{VALUE:due}}, step by step", async () => {
		const { formatter } = makeCapture("(due {{VALUE:due}})");
		datePrompt.mockResolvedValueOnce("@date:2026-09-30T12:00:00.000Z");
		prompt.mockResolvedValueOnce("Pay rent");

		expect(await formatter.formatContentOnly(format))
			.toBe("- Pay rent 📅 30.09.2026\n(due 30.09.2026)");
		expect(datePrompt).toHaveBeenCalledTimes(1);
		expect(datePrompt.mock.calls[0][1]).toBe("When is it due?");
		expect(prompt).toHaveBeenCalledTimes(1);
	});

	it("finds the VDATE in a global variable of a template body", async () => {
		const { formatter } = makeCapture("(due {{VALUE:due}})", {
			globalVariables: { due: "{{VDATE:due,DD.MM.YYYY|label:When is it due?}}" },
		});
		datePrompt.mockResolvedValueOnce("@date:2026-09-30T12:00:00.000Z");

		// A Template choice's body expands globals after its includes; a Capture format expands them first.
		expect(await formatter.formatTemplateContent("📅 {{GLOBAL_VAR:due}}\n{{TEMPLATE:Include.md}}"))
			.toBe("📅 30.09.2026\n(due 30.09.2026)");
		expect(datePrompt).toHaveBeenCalledTimes(1);
		expect(prompt).not.toHaveBeenCalled();
	});

	it.each([
		["two names that differ only by case", "{{VDATE:Due,DD.MM.YYYY}} {{VDATE:DUE,YYYY}}", [["Due", "@date:2026-09-30T12:00:00.000Z"]]],
		["a given answer under another case", "{{VDATE:Due,DD.MM.YYYY}}", [["due", "@date:2026-09-30T12:00:00.000Z"]]],
	])("resolves %s the way the same text inline would", async (_, dates, given) => {
		const run = async (format: string) => {
			prompt.mockReset();
			datePrompt.mockReset();
			prompt.mockResolvedValue("typed");
			datePrompt.mockResolvedValue("@date:2026-10-02T12:00:00.000Z");
			const { formatter, executor } = makeCapture("{{VALUE:due}}");
			for (const [key, value] of given) executor.variables.set(key, value);
			const output = await formatter.formatContentOnly(format);
			return { output, prompts: prompt.mock.calls.length, datePrompts: datePrompt.mock.calls.length };
		};

		expect(await run(`${dates}\n{{TEMPLATE:Include.md}}`)).toEqual(await run(`${dates}\n{{VALUE:due}}`));
	});

	it("prints a prefilled answer, as from the one-page form, in the VDATE's format", async () => {
		const { formatter, executor } = makeCapture("(due {{VALUE:due}})");
		executor.variables.set("value", "Pay rent");
		executor.variables.set("due", "@date:2026-09-30T12:00:00.000Z");

		expect(await formatter.formatContentOnly(format))
			.toBe("- Pay rent 📅 30.09.2026\n(due 30.09.2026)");
		expect(datePrompt).not.toHaveBeenCalled();
		expect(prompt).not.toHaveBeenCalled();
	});
});
