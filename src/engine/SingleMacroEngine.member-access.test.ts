import type { App } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { MacroAbortError } from "../errors/MacroAbortError";
import type QuickAdd from "../main";
import type IChoice from "../types/choices/IChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type { IMacro } from "../types/macros/IMacro";
import type { ICommand } from "../types/macros/ICommand";
import type { IUserScript } from "../types/macros/IUserScript";
import { CommandType } from "../types/macros/CommandType";
import { SingleMacroEngine } from "./SingleMacroEngine";

const { mockInitializeUserScriptSettings, mockGetUserScript } = vi.hoisted(
	() => ({
		mockInitializeUserScriptSettings: vi.fn(),
		mockGetUserScript: vi.fn(),
	}),
);

type MacroEngineInstance = {
	run: ReturnType<typeof vi.fn>;
	runSubset: ReturnType<typeof vi.fn>;
	setOutput: ReturnType<typeof vi.fn>;
	getOutput: ReturnType<typeof vi.fn>;
	params: { variables: Record<string, unknown> };
};

let macroEngineFactory: () => MacroEngineInstance;

vi.mock("./MacroChoiceEngine", () => ({
	MacroChoiceEngine: vi.fn().mockImplementation(() => {
		if (!macroEngineFactory) {
			throw new Error("macroEngineFactory was not initialised.");
		}

		return macroEngineFactory();
	}),
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

vi.mock("../gui/choiceList/ChoiceView.svelte", () => ({}));
vi.mock("../gui/GlobalVariables/GlobalVariablesView.svelte", () => ({}));
vi.mock("../gui/PackageManager/ExportPackageModal.svelte", () => ({}));

vi.mock("../utils/userScriptSettings", () => ({
	initializeUserScriptSettings: mockInitializeUserScriptSettings,
}));

vi.mock("../quickAddApi", () => ({
	QuickAddApi: {
		GetApi: vi.fn(() => ({})),
	},
}));

vi.mock("../quickAddSettingsTab", () => ({
	DEFAULT_SETTINGS: {},
	QuickAddSettingsTab: class {},
}));

vi.mock("../settingsStore", () => ({
	settingsStore: {
		getState: () => ({
			ai: {},
			disableOnlineFeatures: false,
			showInputCancellationNotification: true,
		}),
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

describe("SingleMacroEngine member access", () => {
	const app = {} as App;
	const plugin = {} as unknown as QuickAdd;

	let choiceExecutor: IChoiceExecutor;

	const baseMacroChoice = (commands: ICommand[]): IMacroChoice => ({
		id: "macro-1",
		name: "My Macro",
		type: "Macro",
		command: false,
		runOnStartup: false,
		macro: {
			id: "macro-1",
			name: "My Macro",
			commands,
		} as IMacro,
	});

	const createUserScript = (
		id: string,
		path: string,
		options?: Partial<IUserScript>,
	): IUserScript => ({
		id,
		name: options?.name ?? id,
		type: CommandType.UserScript,
		path,
		settings: {},
	});

	beforeEach(() => {
		vi.clearAllMocks();
		mockGetUserScript.mockReset();
		mockInitializeUserScriptSettings.mockReset();

		choiceExecutor = {
			execute: vi.fn(),
			variables: new Map<string, unknown>([["existing", "value"]]),
		};

		macroEngineFactory = () => ({
			run: vi.fn(),
			runSubset: vi.fn().mockResolvedValue(undefined),
			setOutput: vi.fn(),
			getOutput: vi.fn(),
			params: { variables: { existing: "value" } },
		});
	});

	it("runs the macro when no member access is requested", async () => {
		const userScript = createUserScript("user-script", "script.js");
		const macroChoice = baseMacroChoice([userScript]);
		const choices: IChoice[] = [macroChoice];

		const engineInstance = macroEngineFactory();
		engineInstance.run = vi.fn().mockResolvedValue(undefined);
		engineInstance.getOutput = vi.fn().mockReturnValue(42);
		macroEngineFactory = () => engineInstance;

		const engine = new SingleMacroEngine(app, plugin, choices, choiceExecutor);
		const result = await engine.runAndGetOutput("My Macro");

		expect(engineInstance.run).toHaveBeenCalledTimes(1);
		expect(engineInstance.getOutput).toHaveBeenCalledTimes(1);
		expect(result).toBe("42");
		expect(mockGetUserScript).not.toHaveBeenCalled();
	});

	it("executes the requested export directly when the macro has one user script", async () => {
		const userScript = createUserScript("user-script", "script.js");
		const macroChoice = baseMacroChoice([userScript]);
		const choices: IChoice[] = [macroChoice];

		const engineInstance = macroEngineFactory();
		engineInstance.params.variables = { existing: "value" };
		macroEngineFactory = () => engineInstance;

		const exportFn = vi.fn().mockImplementation(
			(params: { variables: Record<string, unknown> }) => {
				params.variables.newValue = "hello";
				return "f-result";
			},
		);

		mockGetUserScript.mockResolvedValue({
			settings: { prompt: { default: "test" } },
			f: exportFn,
		});

		const engine = new SingleMacroEngine(app, plugin, choices, choiceExecutor);
		const result = await engine.runAndGetOutput("My Macro::f");

		expect(engineInstance.run).not.toHaveBeenCalled();
		expect(engineInstance.runSubset).not.toHaveBeenCalled();
		expect(mockGetUserScript).toHaveBeenCalledWith(userScript, app);
		expect(mockInitializeUserScriptSettings).toHaveBeenCalledWith(
			userScript.settings,
			{ prompt: { default: "test" } },
		);
		expect(exportFn).toHaveBeenCalledWith(engineInstance.params, userScript.settings);
		expect(engineInstance.setOutput).toHaveBeenCalledWith("f-result");
		expect(result).toBe("f-result");
		expect(choiceExecutor.variables.get("newValue")).toBe("hello");
	});

	it("reaches a unique member on a later script while preserving pre and post execution", async () => {
		const preCommand = {
			id: "wait-1",
			name: "Wait",
			type: CommandType.Wait,
		} as ICommand;
		const firstScript = createUserScript("script-1", "script-1.js", {
			name: "Script One",
		});
		const secondScript = createUserScript("script-2", "script-2.js", {
			name: "Script Two",
		});
		const postCommand = {
			id: "choice-1",
			name: "Nested Choice",
			type: CommandType.Choice,
		} as ICommand;

		const choices: IChoice[] = [
			baseMacroChoice([preCommand, firstScript, secondScript, postCommand]),
		];

		const engineInstance = macroEngineFactory();
		macroEngineFactory = () => engineInstance;

		const exportFn = vi.fn().mockReturnValue("export-result");
		mockGetUserScript.mockImplementation(async (command: IUserScript) => {
			if (command.id === "script-2") {
				return {
					settings: {},
					beta: exportFn,
				};
			}

			return {
				settings: {},
				alpha: vi.fn(),
			};
		});

		const engine = new SingleMacroEngine(app, plugin, choices, choiceExecutor);
		const result = await engine.runAndGetOutput("My Macro::beta");

		expect(engineInstance.run).not.toHaveBeenCalled();
		expect(engineInstance.runSubset).toHaveBeenCalledTimes(2);
		expect(engineInstance.runSubset).toHaveBeenNthCalledWith(1, [
			preCommand,
			firstScript,
		]);
		expect(engineInstance.runSubset).toHaveBeenNthCalledWith(2, [postCommand]);
		expect(engineInstance.setOutput).toHaveBeenCalledWith("export-result");
		expect(result).toBe("export-result");
		expect(mockGetUserScript).toHaveBeenCalledTimes(3);
		expect(mockGetUserScript).toHaveBeenCalledWith(firstScript, app);
		expect(mockGetUserScript).toHaveBeenCalledWith(secondScript, app);
	});

	it("aborts when no user script exports the requested member", async () => {
		const scriptA = createUserScript("script-a", "a.js");
		const scriptB = createUserScript("script-b", "b.js");

		mockGetUserScript.mockResolvedValue({ alpha: vi.fn() });

		const engine = new SingleMacroEngine(
			app,
			plugin,
			[baseMacroChoice([scriptA, scriptB])],
			choiceExecutor,
		);

		await expect(engine.runAndGetOutput("My Macro::beta")).rejects.toThrow(
			"could not find 'beta' in any user script",
		);
	});

	it("aborts with candidate names when multiple scripts export the same member", async () => {
		const scriptA = createUserScript("script-a", "a.js", {
			name: "Alpha Script",
		});
		const scriptB = createUserScript("script-b", "b.js", {
			name: "Beta Script",
		});

		mockGetUserScript.mockResolvedValue({ beta: vi.fn() });

		const engine = new SingleMacroEngine(
			app,
			plugin,
			[baseMacroChoice([scriptA, scriptB])],
			choiceExecutor,
		);

		await expect(engine.runAndGetOutput("My Macro::beta")).rejects.toThrow(
			"multiple user scripts exporting 'beta': 'Alpha Script', 'Beta Script'",
		);
	});

	it("uses a script-name selector to resolve a conflict", async () => {
		const scriptA = createUserScript("script-a", "a.js", {
			name: "Alpha Script",
		});
		const scriptB = createUserScript("script-b", "b.js", {
			name: "Beta Script",
		});

		const engineInstance = macroEngineFactory();
		macroEngineFactory = () => engineInstance;

		mockGetUserScript.mockImplementation(async (command: IUserScript) => ({
			beta: () => `${command.name} result`,
		}));

		const engine = new SingleMacroEngine(
			app,
			plugin,
			[baseMacroChoice([scriptA, scriptB])],
			choiceExecutor,
		);

		const result = await engine.runAndGetOutput(
			"My Macro::Beta Script::beta",
		);

		expect(result).toBe("Beta Script result");
		expect(engineInstance.runSubset).toHaveBeenCalledTimes(1);
		expect(engineInstance.runSubset).toHaveBeenCalledWith([scriptA]);
		expect(mockGetUserScript).toHaveBeenCalledTimes(1);
		expect(mockGetUserScript).toHaveBeenCalledWith(scriptB, app);
	});

	it("loads a selector-targeted script after pre-commands run", async () => {
		const preCommand = {
			id: "wait-1",
			name: "Wait",
			type: CommandType.Wait,
		} as ICommand;
		const scriptA = createUserScript("script-a", "a.js", {
			name: "Alpha Script",
		});
		const scriptB = createUserScript("script-b", "b.js", {
			name: "Beta Script",
		});

		let ready = false;
		const engineInstance = macroEngineFactory();
		engineInstance.runSubset = vi.fn().mockImplementation(async () => {
			ready = true;
		});
		macroEngineFactory = () => engineInstance;

		mockGetUserScript.mockImplementation(async (command: IUserScript) => {
			if (command.id !== "script-b") {
				return { alpha: vi.fn() };
			}

			return ready
				? { beta: () => "late-bound-result" }
				: { alpha: vi.fn() };
		});

		const engine = new SingleMacroEngine(
			app,
			plugin,
			[baseMacroChoice([preCommand, scriptA, scriptB])],
			choiceExecutor,
		);

		const result = await engine.runAndGetOutput(
			"My Macro::Beta Script::beta",
		);

		expect(result).toBe("late-bound-result");
		expect(mockGetUserScript).toHaveBeenCalledTimes(1);
		expect(mockGetUserScript).toHaveBeenCalledWith(scriptB, app);
	});

	it("aborts when a selector matches duplicate script names", async () => {
		const scriptA = createUserScript("script-a", "a.js", {
			name: "Shared Script",
		});
		const scriptB = createUserScript("script-b", "b.js", {
			name: "Shared Script",
		});

		const engine = new SingleMacroEngine(
			app,
			plugin,
			[baseMacroChoice([scriptA, scriptB])],
			choiceExecutor,
		);

		await expect(
			engine.runAndGetOutput("My Macro::Shared Script::beta"),
		).rejects.toThrow("multiple user scripts named 'Shared Script'");
		expect(mockGetUserScript).not.toHaveBeenCalled();
	});

	it("treats a non-matching selector-shaped segment as normal member access", async () => {
		const scriptA = createUserScript("script-a", "a.js", {
			name: "Alpha Script",
		});
		const scriptB = createUserScript("script-b", "b.js", {
			name: "Beta Script",
		});

		mockGetUserScript.mockImplementation(async (command: IUserScript) => {
			if (command.id === "script-b") {
				return {
					settings: {},
					NotAScript: {
						beta: () => "nested-result",
					},
				};
			}

			return {
				settings: {},
				alpha: vi.fn(),
			};
		});

		const engine = new SingleMacroEngine(
			app,
			plugin,
			[baseMacroChoice([scriptA, scriptB])],
			choiceExecutor,
		);

		const result = await engine.runAndGetOutput("My Macro::NotAScript::beta");

		expect(result).toBe("nested-result");
		expect(mockGetUserScript).toHaveBeenCalledTimes(3);
	});

	it("aborts when a selected script does not export the requested member", async () => {
		const scriptA = createUserScript("script-a", "a.js", {
			name: "Alpha Script",
		});
		const scriptB = createUserScript("script-b", "b.js", {
			name: "Beta Script",
		});

		mockGetUserScript.mockImplementation(async (command: IUserScript) => {
			if (command.id === "script-a") {
				return { alpha: vi.fn() };
			}

			return { beta: vi.fn() };
		});

		const engine = new SingleMacroEngine(
			app,
			plugin,
			[baseMacroChoice([scriptA, scriptB])],
			choiceExecutor,
		);

		await expect(
			engine.runAndGetOutput("My Macro::Alpha Script::beta"),
		).rejects.toThrow("routes member access to 'Alpha Script'");
	});

	it("propagates aborts when the export aborts", async () => {
		const userScript = createUserScript("user-script", "script.js");
		const choices: IChoice[] = [baseMacroChoice([userScript])];

		const engineInstance = macroEngineFactory();
		engineInstance.runSubset = vi.fn().mockResolvedValue(undefined);
		engineInstance.setOutput = vi.fn();
		macroEngineFactory = () => engineInstance;

		const abortFn = vi.fn().mockImplementation(() => {
			throw new MacroAbortError("stop");
		});

		mockGetUserScript.mockResolvedValue({
			settings: {},
			f: abortFn,
		});

		const engine = new SingleMacroEngine(app, plugin, choices, choiceExecutor);

		await expect(engine.runAndGetOutput("My Macro::f")).rejects.toBeInstanceOf(
			MacroAbortError,
		);
		expect(abortFn).toHaveBeenCalledTimes(1);
		expect(engineInstance.setOutput).not.toHaveBeenCalled();
	});

	it("propagates abort signals when export pre-commands cancel", async () => {
		const preCommand = {
			id: "wait-1",
			name: "Wait",
			type: CommandType.Wait,
		} as ICommand;
		const userScript = createUserScript("user-script", "script.js");
		const choices: IChoice[] = [baseMacroChoice([preCommand, userScript])];

		const engineInstance = macroEngineFactory();
		engineInstance.runSubset = vi.fn().mockResolvedValue(undefined);
		engineInstance.getOutput = vi.fn();
		macroEngineFactory = () => engineInstance;

		const abortError = new MacroAbortError("stop");
		const consumeAbortSignal = vi
			.fn<NonNullable<IChoiceExecutor["consumeAbortSignal"]>>()
			.mockReturnValueOnce(abortError)
			.mockReturnValue(null);
		choiceExecutor.consumeAbortSignal = consumeAbortSignal;

		const engine = new SingleMacroEngine(app, plugin, choices, choiceExecutor);

		await expect(engine.runAndGetOutput("My Macro::run")).rejects.toBe(
			abortError,
		);
		expect(engineInstance.runSubset).toHaveBeenCalledTimes(1);
		expect(mockGetUserScript).not.toHaveBeenCalled();
	});

	it("propagates abort signals when the full macro run cancels", async () => {
		const userScript = createUserScript("user-script", "script.js");
		const choices: IChoice[] = [baseMacroChoice([userScript])];

		const engineInstance = macroEngineFactory();
		engineInstance.run = vi.fn().mockResolvedValue(undefined);
		engineInstance.getOutput = vi.fn();
		macroEngineFactory = () => engineInstance;

		const abortError = new MacroAbortError("whole-macro");
		const consumeAbortSignal = vi
			.fn<NonNullable<IChoiceExecutor["consumeAbortSignal"]>>()
			.mockReturnValueOnce(abortError)
			.mockReturnValue(null);
		choiceExecutor.consumeAbortSignal = consumeAbortSignal;

		const engine = new SingleMacroEngine(app, plugin, choices, choiceExecutor);

		await expect(engine.runAndGetOutput("My Macro")).rejects.toBe(abortError);
		expect(engineInstance.run).toHaveBeenCalledTimes(1);
		expect(engineInstance.getOutput).not.toHaveBeenCalled();
	});
});
