import { beforeEach, describe, expect, it, vi } from "vitest";
import { MacroChoiceEngine } from "./MacroChoiceEngine";
import type QuickAdd from "../main";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type { IMacro } from "../types/macros/IMacro";
import type { IUserScript } from "../types/macros/IUserScript";
import { CommandType } from "../types/macros/CommandType";
import type { App } from "obsidian";

const { mockGetUserScript, mockInitializeUserScriptSettings, mockSuggest, mockGetApi } =
	vi.hoisted(() => ({
		mockGetUserScript: vi.fn(),
		mockInitializeUserScriptSettings: vi.fn(),
		mockSuggest: vi.fn(),
		mockGetApi: vi.fn(() => ({})),
	}));

vi.mock("../utilityObsidian", async () => {
	const actual = await vi.importActual<Record<string, unknown>>(
		"../utilityObsidian",
	);

	return {
		...actual,
		getUserScript: mockGetUserScript,
	};
});

vi.mock("../utils/userScriptSettings", () => ({
	initializeUserScriptSettings: mockInitializeUserScriptSettings,
}));

vi.mock("../gui/choiceList/ChoiceView.svelte", () => ({}));
vi.mock("../gui/GlobalVariables/GlobalVariablesView.svelte", () => ({}));

vi.mock("../gui/GenericSuggester/genericSuggester", () => ({
	__esModule: true,
	default: class {
		static Suggest = mockSuggest;

		constructor() {
			// no-op
		}
	},
}));

vi.mock("../main", () => ({
	__esModule: true,
	default: class QuickAddMock {},
}));

vi.mock("../quickAddApi", () => ({
	QuickAddApi: {
		GetApi: mockGetApi,
	},
}));

vi.mock("../quickAddSettingsTab", () => ({
	DEFAULT_SETTINGS: {},
	QuickAddSettingsTab: class {},
}));

vi.mock("../settingsStore", () => ({
	settingsStore: {
		getState: () => ({ ai: {}, disableOnlineFeatures: false }),
	},
}));

vi.mock("../formatters/completeFormatter", () => ({
	CompleteFormatter: class CompleteFormatterMock {},
}));

vi.mock("../ai/AIAssistant", () => ({
	runAIAssistant: vi.fn(),
}));

vi.mock("../ai/aiHelpers", () => ({
	getModelByName: vi.fn(),
	getModelNames: vi.fn().mockReturnValue([]),
	getModelProvider: vi.fn().mockReturnValue({ apiKey: "" }),
}));

describe("MacroChoiceEngine user script entry handling", () => {
	const app = {} as App;
	const plugin = {} as unknown as QuickAdd;

	let choiceExecutor: IChoiceExecutor;
	let variables: Map<string, unknown>;
	let macroChoice: IMacroChoice;
	let userScriptCommand: IUserScript;

	beforeEach(() => {
		vi.clearAllMocks();
		mockGetUserScript.mockReset();
		mockInitializeUserScriptSettings.mockReset();
		mockSuggest.mockReset();
		mockGetApi.mockReset();
		mockGetApi.mockImplementation(() => ({}));

		variables = new Map<string, unknown>();

		choiceExecutor = {
			execute: vi.fn(),
			variables,
		};

		userScriptCommand = {
			id: "user-script",
			name: "Script",
			type: CommandType.UserScript,
			path: "script.js",
			settings: {},
		};

		macroChoice = {
			id: "macro-1",
			name: "My Macro",
			type: "Macro",
			command: false,
			runOnStartup: false,
			macro: {
				id: "macro-1",
				name: "My Macro",
				commands: [userScriptCommand],
			} as IMacro,
		};
	});

	it("runs the entry export without prompting when no settings are defined", async () => {
		const entryFn = vi.fn().mockResolvedValue("entry-result");

		mockGetUserScript.mockResolvedValue({
			entry: entryFn,
		});

		const engine = new MacroChoiceEngine(
			app,
			plugin,
			macroChoice,
			choiceExecutor,
			variables,
		);

		await engine["executeUserScript"](userScriptCommand);

		expect(mockInitializeUserScriptSettings).not.toHaveBeenCalled();
		expect(mockSuggest).not.toHaveBeenCalled();
		expect(entryFn).toHaveBeenCalledTimes(1);
		const [paramsArg, settingsArg] = entryFn.mock.calls[0];
		expect(settingsArg).toEqual({});
		expect(paramsArg).toHaveProperty("variables");
		expect(engine["output"]).toBe("entry-result");
	});

	it("prompts the user when no entry export is defined", async () => {
		const optionFn = vi.fn().mockResolvedValue("option-result");

		mockGetUserScript.mockResolvedValue({
			option1: optionFn,
		});
		mockSuggest.mockResolvedValueOnce("option1");

		const engine = new MacroChoiceEngine(
			app,
			plugin,
			macroChoice,
			choiceExecutor,
			variables,
		);

		await engine["executeUserScript"](userScriptCommand);

		expect(mockSuggest).toHaveBeenCalledTimes(1);
		expect(optionFn).toHaveBeenCalledTimes(1);
		expect(engine["output"]).toBe("option-result");
	});
});
