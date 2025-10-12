import { describe, expect, it, vi, beforeEach, afterEach, afterAll } from "vitest";
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
		getState: () => ({ ai: {}, disableOnlineFeatures: false }),
	},
}));
vi.mock("../formatters/completeFormatter", () => ({
	CompleteFormatter: class CompleteFormatterMock {
		constructor() {}
	},
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
import { MacroChoiceEngine } from "./MacroChoiceEngine";
import { ConditionalCommand } from "../types/macros/Conditional/ConditionalCommand";
import { ObsidianCommand } from "../types/macros/ObsidianCommand";
import type { IMacro } from "../types/macros/IMacro";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { QuickAddApi } from "../quickAddApi";

const createConditionalCommand = (
	condition: ConditionalCommand["condition"],
	thenId: string,
	elseId: string
) => {
	const thenCommand = new ObsidianCommand("Then command", thenId);
	thenCommand.generateId();
	const elseCommand = new ObsidianCommand("Else command", elseId);
	elseCommand.generateId();

	return new ConditionalCommand({
		condition,
		thenCommands: [thenCommand],
		elseCommands: [elseCommand],
	});
};

const createEngine = (
	command: ConditionalCommand,
	variables: Record<string, unknown>
) => {
	const executeCommandById = vi.fn();
	const app = {
		commands: {
			executeCommandById,
		},
	} as unknown as App;

	const plugin = {
		getChoiceById: vi.fn(),
		getChoiceByName: vi.fn(),
	} as unknown as any;

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

	const variablesMap = new Map<string, unknown>(Object.entries(variables));

	const engine = new MacroChoiceEngine(
		app,
		plugin,
		choice,
		choiceExecutor,
		variablesMap
	);

	return { engine, executeCommandById, choiceExecutor };
};

describe("MacroChoiceEngine conditional commands", () => {
const getApiMock = QuickAddApi.GetApi as unknown as ReturnType<typeof vi.fn>;
getApiMock.mockReturnValue({});

	beforeEach(() => {
		vi.clearAllMocks();
	});

afterEach(() => {
	getApiMock.mockClear();
});

afterAll(() => {
	getApiMock.mockReset();
});

	it("runs then-branch commands when condition is true", async () => {
		const conditional = createConditionalCommand(
			{
				mode: "variable",
				variableName: "status",
				operator: "equals",
				valueType: "string",
				expectedValue: "ready",
			},
			"then-id",
			"else-id"
		);

		const { engine, executeCommandById } = createEngine(conditional, {
			status: "ready",
		});

		await engine.run();

		expect(executeCommandById).toHaveBeenCalledWith("then-id");
		expect(executeCommandById).not.toHaveBeenCalledWith("else-id");
	});

	it("runs else-branch commands when condition is false", async () => {
		const conditional = createConditionalCommand(
			{
				mode: "variable",
				variableName: "status",
				operator: "equals",
				valueType: "string",
				expectedValue: "ready",
			},
			"then-id",
			"else-id"
		);

		const { engine, executeCommandById } = createEngine(conditional, {
			status: "pending",
		});

		await engine.run();

		expect(executeCommandById).toHaveBeenCalledWith("else-id");
		expect(executeCommandById).not.toHaveBeenCalledWith("then-id");
	});

	it("skips missing else branch without errors", async () => {
		const conditional = new ConditionalCommand({
			condition: {
				mode: "variable",
				variableName: "flag",
				operator: "isFalsy",
				valueType: "boolean",
			},
			thenCommands: [new ObsidianCommand("Then", "then-id")],
			elseCommands: [],
		});

	const { engine, executeCommandById } = createEngine(conditional, {
		flag: true,
	});

		await engine.run();

		expect(executeCommandById).not.toHaveBeenCalled();
	});

	it("pulls variables written through QuickAdd API helpers", async () => {
		const conditional = createConditionalCommand(
			{
				mode: "variable",
				variableName: "status",
				operator: "equals",
				valueType: "string",
				expectedValue: "ready",
			},
			"then-id",
			"else-id"
		);

		const { engine, executeCommandById, choiceExecutor } = createEngine(
			conditional,
			{}
		);

		choiceExecutor.variables.set("status", "ready");

		await engine.run();

		expect(executeCommandById).toHaveBeenCalledWith("then-id");
		expect(executeCommandById).not.toHaveBeenCalledWith("else-id");
	});
});
