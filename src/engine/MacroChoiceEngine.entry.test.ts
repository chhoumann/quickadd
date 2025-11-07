import { beforeEach, describe, expect, it, vi } from "vitest";
import { MacroChoiceEngine } from "./MacroChoiceEngine";
import type QuickAdd from "../main";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type { IMacro } from "../types/macros/IMacro";
import type { IUserScript } from "../types/macros/IUserScript";
import { CommandType } from "../types/macros/CommandType";
import type { App } from "obsidian";
import type { IChoiceCommand } from "../types/macros/IChoiceCommand";
import type { INestedChoiceCommand } from "../types/macros/QuickCommands/INestedChoiceCommand";
import type IChoice from "../types/choices/IChoice";
import { MacroAbortError } from "../errors/MacroAbortError";
import { QuickAddApi } from "../quickAddApi";

const { mockGetUserScript, mockInitializeUserScriptSettings, mockSuggest, mockGetApi, mockInputPrompt } =
	vi.hoisted(() => ({
		mockGetUserScript: vi.fn(),
		mockInitializeUserScriptSettings: vi.fn(),
		mockSuggest: vi.fn(),
		mockGetApi: vi.fn(() => ({})),
		mockInputPrompt: vi.fn(),
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
vi.mock("../gui/GenericInputPrompt/GenericInputPrompt", () => ({
	__esModule: true,
	default: {
		Prompt: mockInputPrompt,
	},
}));
vi.mock("../gui/GenericCheckboxPrompt/genericCheckboxPrompt", () => ({
	__esModule: true,
	default: { Open: vi.fn() },
}));
vi.mock("../gui/GenericInfoDialog/GenericInfoDialog", () => ({
	__esModule: true,
	default: { Show: vi.fn() },
}));
vi.mock("../gui/GenericWideInputPrompt/GenericWideInputPrompt", () => ({
	__esModule: true,
	default: { Prompt: vi.fn() },
}));
vi.mock("../gui/GenericYesNoPrompt/GenericYesNoPrompt", () => ({
	__esModule: true,
	default: { Prompt: vi.fn() },
}));
vi.mock("../gui/InputSuggester/inputSuggester", () => ({
	__esModule: true,
	default: { Suggest: vi.fn() },
}));
vi.mock("../preflight/OnePageInputModal", () => ({
	OnePageInputModal: class {
		waitForClose: Promise<never>;
		constructor() {
			this.waitForClose = Promise.reject("cancelled");
		}
	}
}));

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

describe("MacroChoiceEngine choice command cancellation", () => {
	const app = {} as App;
	let plugin: QuickAdd & { getChoiceById: ReturnType<typeof vi.fn> };
	let choiceExecutor: IChoiceExecutor;
	let variables: Map<string, unknown>;
	let macroChoice: IMacroChoice;

	beforeEach(() => {
		plugin = {
			getChoiceById: vi.fn(),
		} as unknown as QuickAdd & { getChoiceById: ReturnType<typeof vi.fn> };
		variables = new Map<string, unknown>();
		choiceExecutor = {
			execute: vi.fn(),
			variables,
			signalAbort: vi.fn(),
			consumeAbortSignal: vi.fn().mockReturnValue(null),
		};
		macroChoice = {
			id: "macro-choice",
			name: "Macro",
			type: "Macro",
			command: false,
			runOnStartup: false,
			macro: {
				id: "macro-id",
				name: "Macro",
				commands: [],
			} as IMacro,
		};
	});

	it("wraps cancellation errors from executeChoice in MacroAbortError", async () => {
		const getApiSpy = vi.spyOn(QuickAddApi, "GetApi");
		getApiSpy.mockReturnValueOnce({} as any);

		const engine = new MacroChoiceEngine(
			app,
			plugin,
			macroChoice,
			choiceExecutor,
			variables,
		);
		const choice: IChoice = {
			id: "target-choice",
			name: "Target",
			type: "Macro",
			command: false,
		};
		(plugin.getChoiceById as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
			choice,
		);
		const command: IChoiceCommand = {
			id: "choice-command",
			name: "Run choice",
			type: CommandType.Choice,
			choiceId: "target-choice",
		};
		const abortError = new MacroAbortError("Input cancelled by user");
		choiceExecutor.execute = vi.fn().mockResolvedValue(undefined);
		(choiceExecutor.consumeAbortSignal as ReturnType<typeof vi.fn>).mockReturnValueOnce(abortError);

		await expect(
			(engine as unknown as { executeChoice: (cmd: IChoiceCommand) => Promise<void> }).executeChoice(
				command,
			),
		).rejects.toThrow(MacroAbortError);
		expect(choiceExecutor.execute).toHaveBeenCalledWith(choice);
		expect(choiceExecutor.consumeAbortSignal).toHaveBeenCalledTimes(1);
	});

	it("wraps cancellation errors from executeNestedChoice in MacroAbortError", async () => {
		const engine = new MacroChoiceEngine(
			app,
			plugin,
			macroChoice,
			choiceExecutor,
			variables,
		);
		const choice: IChoice = {
			id: "nested-choice",
			name: "Nested",
			type: "Macro",
			command: false,
		};
		const command: INestedChoiceCommand = {
			id: "nested-command",
			name: "Nested choice",
			type: CommandType.NestedChoice,
			choice,
		};
		const abortError = new MacroAbortError("Input cancelled by user");
		choiceExecutor.execute = vi.fn().mockResolvedValue(undefined);
		(choiceExecutor.consumeAbortSignal as ReturnType<typeof vi.fn>).mockReturnValueOnce(abortError);

		await expect(
			(engine as unknown as {
				executeNestedChoice: (
					cmd: INestedChoiceCommand,
				) => Promise<void>;
			}).executeNestedChoice(command),
		).rejects.toThrow(MacroAbortError);
		expect(choiceExecutor.execute).toHaveBeenCalledWith(choice);
		expect(choiceExecutor.consumeAbortSignal).toHaveBeenCalledTimes(1);
	});
});

describe("QuickAddApi prompt cancellation", () => {
	const app = {} as App;

	beforeEach(() => {
		mockInputPrompt.mockReset();
	});

	it("throws MacroAbortError when input prompt is cancelled", async () => {
		mockInputPrompt.mockRejectedValueOnce("No input given.");

		await expect(
			QuickAddApi.inputPrompt(app, "Enter value"),
		).rejects.toThrow(MacroAbortError);
	});

	it("still resolves undefined for other prompt errors", async () => {
		mockInputPrompt.mockRejectedValueOnce(new Error("boom"));

		await expect(
			QuickAddApi.inputPrompt(app, "Enter value"),
		).resolves.toBeUndefined();
	});
});
