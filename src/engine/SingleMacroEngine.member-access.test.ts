import { beforeEach, describe, expect, it, vi } from "vitest";
import { SingleMacroEngine } from "./SingleMacroEngine";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type QuickAdd from "../main";
import type IChoice from "../types/choices/IChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type { IMacro } from "../types/macros/IMacro";
import type { IUserScript } from "../types/macros/IUserScript";
import { CommandType } from "../types/macros/CommandType";

const { mockInitializeUserScriptSettings, mockGetUserScript } = vi.hoisted(
	() => ({
		mockInitializeUserScriptSettings: vi.fn(),
		mockGetUserScript: vi.fn(),
	}),
);

type MacroEngineInstance = {
	run: ReturnType<typeof vi.fn>;
	getOutput: ReturnType<typeof vi.fn>;
	params: { variables: Record<string, unknown> };
};

let macroEngineFactory: () => MacroEngineInstance;

vi.mock("./MacroChoiceEngine", () => ({
	MacroChoiceEngine: vi.fn().mockImplementation(() => {
		if (!macroEngineFactory) {
			throw new Error("macroEngineFactory was not initialised.");
		}

		const instance = macroEngineFactory();
		return instance;
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

vi.mock("../utils/userScriptSettings", () => ({
	initializeUserScriptSettings: mockInitializeUserScriptSettings,
}));

describe("SingleMacroEngine member access", () => {
	const app = {} as unknown as import("obsidian").App;
	const plugin = {} as unknown as QuickAdd;

	let choiceExecutor: IChoiceExecutor;
	let variables: Map<string, unknown>;

	const baseMacroChoice = (
		commands: IUserScript[],
	): IMacroChoice => ({
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

	beforeEach(() => {
		vi.clearAllMocks();
		mockGetUserScript.mockReset();
		mockInitializeUserScriptSettings.mockReset();

		variables = new Map<string, unknown>([["existing", "value"]]);
		choiceExecutor = {
			execute: vi.fn(),
			variables,
		};

		macroEngineFactory = () => ({
			run: vi.fn(),
			getOutput: vi.fn(),
			params: { variables: { existing: "value" } },
		});
	});

	it("runs the macro when no member access is requested", async () => {
		const macroChoice = baseMacroChoice([
			{
				id: "user-script",
				name: "Script",
				type: CommandType.UserScript,
				path: "script.js",
				settings: {},
			},
		]);

		const choices: IChoice[] = [macroChoice];

		const engineInstance = macroEngineFactory();
		engineInstance.run = vi.fn().mockResolvedValue(undefined);
		engineInstance.getOutput = vi.fn().mockReturnValue(42);
		macroEngineFactory = () => engineInstance;

		const engine = new SingleMacroEngine(
			app,
			plugin,
			choices,
			choiceExecutor,
		);

		const result = await engine.runAndGetOutput("My Macro");

		expect(engineInstance.run).toHaveBeenCalledTimes(1);
		expect(engineInstance.getOutput).toHaveBeenCalledTimes(1);
		expect(result).toBe("42");
		expect(mockGetUserScript).not.toHaveBeenCalled();
	});

	it("executes the requested export directly when member access is provided", async () => {
		const userScript: IUserScript = {
			id: "user-script",
			name: "Script",
			type: CommandType.UserScript,
			path: "script.js",
			settings: {},
		};

		const macroChoice = baseMacroChoice([userScript]);
		const choices: IChoice[] = [macroChoice];

		const engineInstance = macroEngineFactory();
		engineInstance.params.variables = { existing: "value" };
		engineInstance.run = vi.fn();
		macroEngineFactory = () => engineInstance;

		const exportFn = vi.fn().mockImplementation((params: any) => {
			params.variables.newValue = "hello";
			return "f-result";
		});

		mockGetUserScript.mockResolvedValue({
			settings: { prompt: { default: "test" } },
			f: exportFn,
		});

		const engine = new SingleMacroEngine(
			app,
			plugin,
			choices,
			choiceExecutor,
		);

		const result = await engine.runAndGetOutput("My Macro::f");

		expect(engineInstance.run).not.toHaveBeenCalled();
		expect(mockGetUserScript).toHaveBeenCalledWith(userScript, app);
		expect(mockInitializeUserScriptSettings).toHaveBeenCalledWith(
			userScript.settings,
			{ prompt: { default: "test" } },
		);
		expect(exportFn).toHaveBeenCalledWith(engineInstance.params, userScript.settings);
		expect(result).toBe("f-result");
		expect(choiceExecutor.variables.get("newValue")).toBe("hello");
	});

	it("throws when the requested export does not exist", async () => {
		const userScript: IUserScript = {
			id: "user-script",
			name: "Script",
			type: CommandType.UserScript,
			path: "script.js",
			settings: {},
		};

		const macroChoice = baseMacroChoice([userScript]);
		const choices: IChoice[] = [macroChoice];

		mockGetUserScript.mockResolvedValue({
			entry: vi.fn(),
		});

		const engine = new SingleMacroEngine(
			app,
			plugin,
			choices,
			choiceExecutor,
		);

		await expect(engine.runAndGetOutput("My Macro::missing")).rejects.toThrow(
			"macro 'My Macro' does not export member 'missing'.",
		);
	});
});
