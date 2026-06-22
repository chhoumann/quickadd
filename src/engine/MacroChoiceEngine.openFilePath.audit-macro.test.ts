import { describe, expect, it, vi, beforeEach, afterEach, afterAll } from "vitest";

const { formatFileNameMock, openFileMock } = vi.hoisted(() => ({
	formatFileNameMock: vi.fn(async (path: string) => path),
	openFileMock: vi.fn(
		async (_app: unknown, _file: unknown, _options?: unknown) => {}
	),
}));

vi.mock("../quickAddApi", () => ({
	QuickAddApi: {
		GetApi: vi.fn(),
	},
}));
vi.mock("../gui/GenericSuggester/genericSuggester", () => ({
	default: class GenericSuggesterMock {
		static Suggest() {
			return Promise.resolve(undefined);
		}
	},
}));
vi.mock("../main", () => ({
	default: class QuickAddMock {},
}));
vi.mock("../gui/choiceList/ChoiceView.svelte", () => ({}));
vi.mock("../quickAddSettingsTab", () => ({
	DEFAULT_SETTINGS: {},
	QuickAddSettingsTab: class {},
}));
vi.mock("../settingsStore", () => ({
	settingsStore: {
		getState: () => ({
			ai: {},
			disableOnlineFeatures: false,
			showInputCancellationNotification: false,
		}),
	},
}));
vi.mock("../formatters/completeFormatter", () => ({
	CompleteFormatter: class CompleteFormatterMock {
		formatFileName = formatFileNameMock;
	},
}));
vi.mock("../utilityObsidian", () => ({
	getUserScript: vi.fn(),
	openFile: openFileMock,
}));
vi.mock("../quickAddInstance", () => ({
	getQuickAddInstance: vi.fn(() => ({})),
}));
vi.mock("../ai/AIAssistant", () => ({
	runAIAssistant: vi.fn(),
}));
vi.mock("../ai/aiHelpers", () => ({
	getModelByName: vi.fn(),
	getModelNames: vi.fn().mockReturnValue([]),
	getModelProvider: vi.fn().mockReturnValue({ apiKey: "" }),
}));

import type { App } from "obsidian";
import { TFile } from "obsidian";
import { MacroChoiceEngine } from "./MacroChoiceEngine";
import { OpenFileCommand } from "../types/macros/QuickCommands/OpenFileCommand";
import type { IMacro } from "../types/macros/IMacro";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { QuickAddApi } from "../quickAddApi";

const getApiMock = QuickAddApi.GetApi as unknown as ReturnType<typeof vi.fn>;

function makeFile(path: string): TFile {
	const file = new TFile();
	file.path = path;
	return file;
}

function createEngine(filePath: string, existingPaths: Record<string, TFile>) {
	const app = {
		vault: {
			getAbstractFileByPath: vi.fn(
				(path: string) => existingPaths[path] ?? null
			),
		},
	} as unknown as App;

	const plugin = {
		getChoiceById: vi.fn(),
		getChoiceByName: vi.fn(),
	} as unknown as any;

	const command = new OpenFileCommand(filePath);

	const macro: IMacro = {
		name: "Test macro",
		id: "macro-id",
		commands: [command],
	};

	const choice: IMacroChoice = {
		name: "Test choice",
		id: "choice-id",
		type: "Macro",
		command: false,
		macro,
		runOnStartup: false,
	};

	const choiceExecutor: IChoiceExecutor = {
		execute: vi.fn(),
		variables: new Map<string, unknown>(),
	};

	const engine = new MacroChoiceEngine(
		app,
		plugin,
		choice,
		choiceExecutor,
		new Map<string, unknown>()
	);

	return { engine };
}

describe("MacroChoiceEngine executeOpenFile path validation", () => {
	beforeEach(() => {
		getApiMock.mockReturnValue({});
		formatFileNameMock.mockClear();
		openFileMock.mockClear();
	});

	afterEach(() => {
		getApiMock.mockClear();
	});

	afterAll(() => {
		getApiMock.mockReset();
	});

	it("opens a legitimate file whose name contains '..'", async () => {
		const file = makeFile("log..2024.md");
		const { engine } = createEngine("log..2024.md", {
			"log..2024.md": file,
		});

		await engine.run();

		expect(openFileMock).toHaveBeenCalledTimes(1);
		expect(openFileMock.mock.calls[0][1]).toBe(file);
	});

	it("still rejects an actual '..' traversal segment", async () => {
		const file = makeFile("../secret.md");
		const { engine } = createEngine("../secret.md", {
			"../secret.md": file,
		});

		await engine.run();

		expect(openFileMock).not.toHaveBeenCalled();
	});
});
