import { createChoiceExecutor } from "../../tests/helpers/createChoiceExecutor";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import { TFile as ObsidianTFile } from "obsidian";
import { CaptureChoiceEngine } from "./CaptureChoiceEngine";
import { CaptureChoice } from "../types/choices/CaptureChoice";
import { templaterParseTemplate } from "../utils/templaterIntegration";

// The real CaptureChoiceFormatter runs here: only the executable steps
// (inline scripts, macros, Templater) are replaced with recorders.
const { scriptRuns, macroRuns } = vi.hoisted(() => ({
	scriptRuns: [] as string[],
	macroRuns: [] as string[],
}));

vi.mock("../quickAddSettingsTab", () => ({ DEFAULT_SETTINGS: {}, QuickAddSettingsTab: class {} }));
vi.mock("../gui/choiceList/ChoiceView.svelte", () => ({ default: class {} }));
vi.mock("../engine/SingleInlineScriptEngine", () => ({
	SingleInlineScriptEngine: class {
		public params = { variables: {} as Record<string, unknown> };
		async runAndGetOutput(code: string) {
			scriptRuns.push(code);
			return "SCRIPT-RAN";
		}
	},
}));
vi.mock("../engine/SingleMacroEngine", () => ({
	SingleMacroEngine: class {
		async runAndGetOutput(name: string) {
			macroRuns.push(name);
			return "MACRO-RAN";
		}
		getVariables() {
			return new Map();
		}
	},
}));
// Stands in for Templater: a tag that upper-cases a string literal renders it,
// any other tag renders as TP-RAN.
vi.mock("../utils/templaterIntegration", async (importOriginal) => ({
	...(await importOriginal<object>()),
	templaterParseTemplate: vi.fn(async (_app: App, content: string) => content
		.replace(/<%\s*"([^"]*)"\.toUpperCase\(\)\s*%>/g, (_tag, text: string) => text.toUpperCase())
		.replace(/<%[\s\S]*?%>/g, "TP-RAN")),
}));

const PAYLOAD = "clipped ```js quickadd\nreturn 'x';\n``` {{MACRO:m}} {{DATE:YYYY}}";
const TARGET = "Inbox.md";

function setup(options: { selection?: string; answer?: string; exists?: boolean }) {
	const files = new Map<string, string>();
	if (options.exists !== false) files.set(TARGET, "# Inbox\n");
	const file = { path: TARGET, name: TARGET, basename: "Inbox", extension: "md" } as TFile;
	Object.setPrototypeOf(file, ObsidianTFile.prototype);
	const editor = { getSelection: () => options.selection ?? "" };
	const app = {
		vault: {
			adapter: { exists: vi.fn(async (path: string) => files.has(path)) },
			getAbstractFileByPath: vi.fn((path: string) => (files.has(path) ? file : null)),
			read: vi.fn(async () => files.get(TARGET) ?? ""),
			createFolder: vi.fn(),
			create: vi.fn(async (path: string, content: string) => {
				files.set(path, content);
				return file;
			}),
			process: vi.fn(async (_file: TFile, fn: (content: string) => string) => {
				files.set(TARGET, fn(files.get(TARGET) ?? ""));
				return files.get(TARGET);
			}),
		},
		fileManager: { generateMarkdownLink: vi.fn(() => "") },
		workspace: {
			getActiveFile: vi.fn(() => null),
			getActiveViewOfType: vi.fn(() => ({ editor })),
			getLeavesOfType: vi.fn(() => []),
		},
		metadataCache: { getFileCache: vi.fn(() => null) },
		plugins: { plugins: {} },
	} as unknown as App;
	const plugin = { settings: { globalVariables: {}, useSelectionAsCaptureValue: true, choices: [] } } as never;
	const executor = { ...createChoiceExecutor(), variables: new Map<string, unknown>() };
	if (options.answer !== undefined) executor.variables.set("answer", options.answer);
	return { app, plugin, executor, files };
}

function captureChoice(format: string, configure?: (choice: CaptureChoice) => void) {
	const choice = new CaptureChoice("Capture");
	choice.captureTo = TARGET;
	choice.format = { enabled: true, format };
	choice.createFileIfItDoesntExist.enabled = true;
	configure?.(choice);
	return choice;
}

async function run(format: string, options: Parameters<typeof setup>[0], configure?: (choice: CaptureChoice) => void) {
	const { app, plugin, executor, files } = setup(options);
	await new CaptureChoiceEngine(app, plugin, captureChoice(format, configure), executor).run();
	return files.get(TARGET);
}

describe("Capture keeps selected and answered text as data", () => {
	beforeEach(() => {
		scriptRuns.length = 0;
		macroRuns.length = 0;
		vi.mocked(templaterParseTemplate).mockClear();
	});

	it.each([
		["bottom", (choice: CaptureChoice) => { choice.prepend = true; }],
		["top", undefined],
		["insert after", (choice: CaptureChoice) => {
			choice.insertAfter.enabled = true;
			choice.insertAfter.after = "# Inbox";
		}],
	])("writes a selection verbatim when capturing to the %s of a note", async (_mode, configure) => {
		const written = await run("{{SELECTED}}", { selection: PAYLOAD }, configure);

		expect(written).toContain(PAYLOAD);
		expect(scriptRuns).toEqual([]);
		expect(macroRuns).toEqual([]);
	});

	it("writes a prompt answer verbatim into a new note", async () => {
		const written = await run("{{VALUE:answer}}", { answer: PAYLOAD, exists: false });

		expect(written).toBe(PAYLOAD);
		expect(scriptRuns).toEqual([]);
		expect(macroRuns).toEqual([]);
	});

	it("still runs the capture format's own script, macro and Templater once", async () => {
		const written = await run("```js quickadd\nreturn 'x';\n``` {{MACRO:m}} {{SELECTED}}", { selection: "picked" }, (choice) => {
			choice.prepend = true;
		});

		expect(written).toBe("# Inbox\nSCRIPT-RAN MACRO-RAN picked");
		expect(scriptRuns).toEqual(["return 'x';"]);
		expect(macroRuns).toEqual(["m"]);
		expect(templaterParseTemplate).toHaveBeenCalledTimes(1);
		expect(vi.mocked(templaterParseTemplate).mock.calls[0][1]).toBe("SCRIPT-RAN MACRO-RAN picked");
	});
});

describe("Capture keeps tokens and Templater tags inside user text literal", () => {
	const USER_TEXT = "a {{TITLE}} {{RANDOM:3}} {{LINKCURRENT}} {{VALUE:answer}} {{CURSOR}} <% tp.date.now() %> b";

	it.each([
		["bottom", (choice: CaptureChoice) => { choice.prepend = true; }],
		["top", undefined],
		["insert after", (choice: CaptureChoice) => {
			choice.insertAfter.enabled = true;
			choice.insertAfter.after = "# Inbox";
		}],
	])("writes a selection as it is when capturing to the %s of a note", async (_mode, configure) => {
		const written = await run("<% 'own' %>|{{SELECTED}}|", { selection: USER_TEXT, answer: "unused" }, configure);

		expect(written).toContain(`TP-RAN|${USER_TEXT}|`);
	});

	it("writes an answer as it is into a new note", async () => {
		const written = await run("{{VALUE:answer}} {{TITLE}}", { answer: USER_TEXT, exists: false });

		expect(written).toBe(`${USER_TEXT} Inbox`);
	});

	it("still gives the answer to a Templater tag in the format", async () => {
		const written = await run('<% "{{VALUE:answer}}".toUpperCase() %> {{SELECTED}}', {
			answer: "x <% y %> {{TITLE}}", selection: "<% z %>",
		}, (choice) => { choice.prepend = true; });

		expect(written).toBe("# Inbox\nX <% Y %> {{TITLE}} <% z %>");
	});
});
