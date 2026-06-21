import { describe, expect, it, vi, beforeEach } from "vitest";

// Finding: ai-assistant-disable-online-features — the AI Assistant guard in
// MacroChoiceEngine.executeAIAssistant hardcoded "OpenAI" in its block message
// regardless of the configured provider. This locks in the provider-neutral
// wording (matching src/ai/AIAssistant.ts) and that the request never proceeds.

const storeState = vi.hoisted(() => ({
	ai: {} as Record<string, unknown>,
	disableOnlineFeatures: false,
	showInputCancellationNotification: false,
}));

vi.mock("../quickAddApi", () => ({
	QuickAddApi: {
		GetApi: vi.fn().mockReturnValue({}),
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
		getState: () => storeState,
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
import { CommandType } from "../types/macros/CommandType";
import type { ICommand } from "../types/macros/ICommand";
import type { IMacro } from "../types/macros/IMacro";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { runAIAssistant } from "../ai/AIAssistant";

const runAIAssistantMock = runAIAssistant as unknown as ReturnType<typeof vi.fn>;

function createEngine(commands: ICommand[]) {
	const app = {
		commands: {
			commands: {},
			executeCommandById: vi.fn(),
		},
	} as unknown as App;

	const plugin = {
		getChoiceById: vi.fn(),
		getChoiceByName: vi.fn(),
	} as unknown as never;

	const choiceExecutor: IChoiceExecutor = {
		variables: new Map<string, unknown>(),
		execute: vi.fn(),
		signalAbort: vi.fn(),
		consumeAbortSignal: vi.fn(),
	};

	const macro: IMacro = { name: "Test macro", id: "macro-id", commands };
	const choice: IMacroChoice = {
		name: "Test choice",
		id: "choice-id",
		type: "Macro",
		command: false,
		macro,
		runOnStartup: false,
	};

	return new MacroChoiceEngine(
		app,
		plugin,
		choice,
		choiceExecutor,
		new Map<string, unknown>()
	);
}

function makeAIAssistantCommand(): ICommand {
	return {
		id: "ai-cmd",
		name: "AI Assistant",
		type: CommandType.AIAssistant,
		model: "Ask me",
		systemPrompt: "",
		outputVariableName: "output",
		promptTemplate: { enable: false, name: "" },
		modelParameters: {},
	} as unknown as ICommand;
}

describe("MacroChoiceEngine executeAIAssistant disable-online-features guard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		storeState.disableOnlineFeatures = false;
		storeState.ai = {};
	});

	it("blocks with a provider-neutral message that does not name OpenAI", async () => {
		storeState.disableOnlineFeatures = true;

		const engine = createEngine([makeAIAssistantCommand()]);

		await expect(engine.run()).rejects.toThrow(
			"Blocking request: Online features are disabled in settings."
		);
		await expect(engine.run()).rejects.not.toThrow(/OpenAI/);
		// The guard short-circuits before the assistant ever runs.
		expect(runAIAssistantMock).not.toHaveBeenCalled();
	});
});
