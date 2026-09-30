import { createChoiceExecutor } from "../../tests/helpers/createChoiceExecutor";
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
vi.mock("../utils/templaterRerunDeprecation", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	warnDeprecatedOnce: vi.fn(),
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
import type { ICommand } from "../types/macros/ICommand";
import { UserScript } from "../types/macros/UserScript";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { QuickAddApi } from "../quickAddApi";
import { NestedChoiceCommand } from "../types/macros/QuickCommands/NestedChoiceCommand";
import { CaptureChoice } from "../types/choices/CaptureChoice";
import { TemplateChoice } from "../types/choices/TemplateChoice";
import { TEMPLATER_REPLACE_COMMAND_ID, warnDeprecatedOnce } from "../utils/templaterRerunDeprecation";

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
	command: ConditionalCommand | ICommand[],
	variables: Record<string, unknown>
) => {
	const executeCommandById = vi.fn();
	const app = {
		commands: {
			executeCommandById,
		},
		// No file exists at any path: every user script is missing.
		vault: { getAbstractFileByPath: () => null },
	} as unknown as App;

	const plugin = {
		getChoiceById: vi.fn(),
		getChoiceByName: vi.fn(),
	} as unknown as any;

	const macro: IMacro = {
		name: "Test macro",
		id: "macro-id",
		commands: Array.isArray(command) ? command : [command],
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
		...createChoiceExecutor(),
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

	it("stops the macro when a user script is missing", async () => {
		const { engine, executeCommandById } = createEngine(
			[new UserScript("gone", "scripts/gone.js"), new ObsidianCommand("After", "after-id")],
			{},
		);

		await expect(engine.run()).rejects.toThrow("QuickAdd could not find scripts/gone.js.");
		expect(executeCommandById).not.toHaveBeenCalled();
	});

	it("stops the macro when a conditional's script is missing, running neither branch", async () => {
		const conditional = createConditionalCommand(
			{ mode: "script", scriptPath: "scripts/gone.js" },
			"then-id",
			"else-id"
		);
		const { engine, executeCommandById } = createEngine(conditional, {});

		await expect(engine.run()).rejects.toThrow("QuickAdd could not find scripts/gone.js.");
		expect(executeCommandById).not.toHaveBeenCalled();
	});
});

// #2020 review: the Templater re-run notice must see the step before
// "Replace templates" even when one of them is inside a Conditional branch.
describe("MacroChoiceEngine Templater re-run notice across branches", () => {
	const always = {
		mode: "variable",
		variableName: "go",
		operator: "equals",
		valueType: "string",
		expectedValue: "yes",
	} as ConditionalCommand["condition"];
	const replace = () => new ObsidianCommand("Templater: Replace templates in the active file", TEMPLATER_REPLACE_COMMAND_ID);
	const warned = () => (warnDeprecatedOnce as ReturnType<typeof vi.fn>).mock.calls.map(([, message]) => message as string);

	beforeEach(() => vi.clearAllMocks());

	it("warns when a branch ends with a Capture and Replace templates follows the Conditional", async () => {
		const conditional = new ConditionalCommand({
			condition: always,
			thenCommands: [new NestedChoiceCommand(new CaptureChoice("Branch capture"))],
			elseCommands: [],
		});
		const { engine } = createEngine([conditional, replace()], { go: "yes" });
		await engine.run();
		expect(warned()).toEqual([expect.stringContaining("after 'Branch capture'")]);
	});

	it("warns when a branch starts with Replace templates after an outer Template step", async () => {
		const conditional = new ConditionalCommand({
			condition: always,
			thenCommands: [replace()],
			elseCommands: [],
		});
		const template = new NestedChoiceCommand(new TemplateChoice("Outer template"));
		const { engine } = createEngine([template, conditional], { go: "yes" });
		await engine.run();
		expect(warned()).toEqual([expect.stringContaining("after 'Outer template'")]);
	});

	it("does not treat the Conditional itself as the step before", async () => {
		const conditional = new ConditionalCommand({ condition: always, thenCommands: [], elseCommands: [] });
		const template = new NestedChoiceCommand(new TemplateChoice("Before the conditional"));
		const { engine } = createEngine([template, conditional, replace()], { go: "no" });
		await engine.run();
		expect(warned()).toEqual([expect.stringContaining("after 'Before the conditional'")]);
	});
});

