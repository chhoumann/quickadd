// @vitest-environment jsdom
import { createChoiceExecutor } from "../../tests/helpers/createChoiceExecutor";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import { Notice, TFile as ObsidianTFile } from "obsidian";
import { CaptureChoiceEngine } from "./CaptureChoiceEngine";
import { CaptureChoice } from "../types/choices/CaptureChoice";
import { testFormatterRuntime } from "../../tests/helpers/formatterRuntime";

// The real CaptureChoiceFormatter places the text, so the engine's notice and
// the formatter's placement are checked against each other.
vi.mock("../quickAddSettingsTab", () => ({ DEFAULT_SETTINGS: {}, QuickAddSettingsTab: class {} }));
vi.mock("../gui/choiceList/ChoiceView.svelte", () => ({ default: class {} }));
vi.mock("../utils/templaterIntegration", async (importOriginal) => ({
	...(await importOriginal<object>()),
	templaterParseTemplate: vi.fn(async (_app: App, content: string) => content),
}));

const TARGET = "Inbox.md";
const notices = (Notice as unknown as { instances: Array<{ message: string }> }).instances;

async function capture(configure: (choice: CaptureChoice) => void) {
	const files = new Map([[TARGET, "# Inbox\n## Log\n- old\n## Later\n"]]);
	const file = { path: TARGET, name: TARGET, basename: "Inbox", extension: "md" } as TFile;
	Object.setPrototypeOf(file, ObsidianTFile.prototype);
	const app = {
		vault: {
			adapter: { exists: vi.fn(async (path: string) => files.has(path)) },
			getAbstractFileByPath: vi.fn((path: string) => (files.has(path) ? file : null)),
			read: vi.fn(async () => files.get(TARGET) ?? ""),
			process: vi.fn(async (_file: TFile, fn: (content: string) => string) => {
				files.set(TARGET, fn(files.get(TARGET) ?? ""));
				return files.get(TARGET);
			}),
		},
		fileManager: { generateMarkdownLink: vi.fn(() => "") },
		workspace: {
			getActiveFile: vi.fn(() => null),
			getActiveViewOfType: vi.fn(() => null),
			getLeavesOfType: vi.fn(() => []),
		},
		metadataCache: { getFileCache: vi.fn(() => null) },
		plugins: { plugins: {} },
	} as unknown as App;
	const plugin = { settings: { globalVariables: {}, showCaptureNotification: true, choices: [] } } as never;
	const choice = new CaptureChoice("Capture");
	choice.captureTo = TARGET;
	choice.format = { enabled: true, format: "- new\n" };
	configure(choice);
	await new CaptureChoiceEngine(app, plugin, testFormatterRuntime(app, plugin), choice, createChoiceExecutor()).run();
	return { written: files.get(TARGET), notice: notices.at(-1)?.message };
}

describe("Capture write position", () => {
	beforeEach(() => {
		notices.length = 0;
	});

	// A hand-edited or imported choice can carry both flags. The notice must name
	// the position the formatter actually wrote to.
	it.each([
		["insert after", (choice: CaptureChoice) => {
			choice.insertAfter.enabled = true;
			choice.insertAfter.after = "## Log";
		}],
		["insert before", (choice: CaptureChoice) => {
			choice.insertBefore = { enabled: true, before: "## Later", createIfNotFound: false, createIfNotFoundLocation: "top" };
		}],
	])("reports the bottom write it makes when prepend and %s are both set", async (_label, lineTarget) => {
		const { written, notice } = await capture((choice) => {
			choice.prepend = true;
			lineTarget(choice);
		});

		expect(written).toBe("# Inbox\n## Log\n- old\n## Later\n- new\n");
		expect(notice).toBe("Captured to bottom of 'Inbox'");
	});

	it("reports an insert-after write under its heading", async () => {
		const { written, notice } = await capture((choice) => {
			choice.insertAfter.enabled = true;
			choice.insertAfter.after = "## Log";
		});

		expect(written).toBe("# Inbox\n## Log\n- old\n- new\n## Later\n");
		expect(notice).toBe("Captured to 'Inbox' under '## Log'");
	});
});
