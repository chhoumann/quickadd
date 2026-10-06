import realMoment from "moment";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import { TFile as ObsidianTFile } from "obsidian";
import { createChoiceExecutor } from "../../tests/helpers/createChoiceExecutor";
import { logCapture } from "../gui/choiceList/presets";
import { CaptureChoiceEngine } from "./CaptureChoiceEngine";

// The real CaptureChoiceFormatter runs here; only the prompt is a recorder.
const { prompts } = vi.hoisted(() => ({
	prompts: [] as Array<{ header: string; contextLine?: string }>,
}));

vi.mock("../quickAddSettingsTab", () => ({ DEFAULT_SETTINGS: {}, QuickAddSettingsTab: class {} }));
vi.mock("../gui/choiceList/ChoiceView.svelte", () => ({ default: class {} }));
vi.mock("../gui/InputPrompt", () => ({
	default: class {
		factory() {
			return {
				Prompt: async (...args: unknown[]) => {
					const options = args.at(-1) as { contextLine?: string } | undefined;
					prompts.push({ header: args[1] as string, contextLine: options?.contextLine });
					return "Planted the tomatoes";
				},
			};
		}
	},
}));

const originalMoment = (window as unknown as { moment?: unknown }).moment;
beforeAll(() => {
	realMoment.locale("en");
	(window as unknown as { moment: unknown }).moment = realMoment;
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-10-06T10:00:00"));
});
afterAll(() => {
	(window as unknown as { moment?: unknown }).moment = originalMoment;
	vi.useRealTimers();
});

it("tells the last prompt of a Log to {{DAILY}} the note and heading it adds under", async () => {
	const files = new Map<string, string>();
	const app = {
		vault: {
			adapter: { exists: vi.fn(async (path: string) => files.has(path)) },
			getAbstractFileByPath: vi.fn(() => null),
			read: vi.fn(async (file: TFile) => files.get(file.path) ?? ""),
			createFolder: vi.fn(),
			create: vi.fn(async (path: string, content: string) => {
				files.set(path, content);
				const file = { path, name: path.split("/").pop(), basename: "2026-10-06", extension: "md" } as TFile;
				return Object.setPrototypeOf(file, ObsidianTFile.prototype) as TFile;
			}),
			process: vi.fn(async (file: TFile, fn: (content: string) => string) => {
				files.set(file.path, fn(files.get(file.path) ?? ""));
				return files.get(file.path);
			}),
		},
		fileManager: { generateMarkdownLink: vi.fn(() => "") },
		workspace: { getActiveFile: () => null, getActiveViewOfType: () => null, getLeavesOfType: () => [] },
		metadataCache: { getFileCache: () => null },
		plugins: { plugins: {} },
		internalPlugins: {
			plugins: { "daily-notes": { enabled: true, instance: { options: { folder: "Journal", format: "YYYY-MM-DD" } } } },
		},
	} as unknown as App;
	const plugin = { settings: { globalVariables: {}, useSelectionAsCaptureValue: false, choices: [] } } as never;

	await new CaptureChoiceEngine(app, plugin, logCapture("Log"), createChoiceExecutor()).run();

	// The form's preview row says "Adds to Journal/2026-10-06.md under ## Log";
	// the prompt's title already names the choice.
	expect(prompts).toEqual([{ header: "Log", contextLine: "→ Journal/2026-10-06.md under ## Log" }]);
	expect(files.get("Journal/2026-10-06.md")).toBe("## Log\n- 10:00 Planted the tomatoes");
});
