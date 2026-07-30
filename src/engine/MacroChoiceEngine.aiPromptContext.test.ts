import { describe, expect, it, vi, beforeEach } from "vitest";

const { runAIAssistantMock, setPromptRunContextMock } = vi.hoisted(() => ({
	runAIAssistantMock: vi.fn(async () => ({})),
	setPromptRunContextMock: vi.fn(),
}));

vi.mock("../quickAddApi", () => ({
	QuickAddApi: {
		GetApi: vi.fn(() => ({})),
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
			ai: {
				promptTemplatesFolderPath: "",
				showAssistant: false,
				providers: [],
			},
			disableOnlineFeatures: false,
			showInputCancellationNotification: false,
		}),
	},
}));
vi.mock("../formatters/completeFormatter", () => ({
	CompleteFormatter: class CompleteFormatterMock {
		formatFileContent = vi.fn(async (input: string) => input);
		setPromptRunContext = setPromptRunContextMock;
	},
}));
vi.mock("../utilityObsidian", () => ({
	getUserScript: vi.fn(),
	openFile: vi.fn(),
}));
vi.mock("../quickAddInstance", () => ({
	getQuickAddInstance: vi.fn(() => ({})),
}));
vi.mock("../ai/AIAssistant", () => ({
	runAIAssistant: runAIAssistantMock,
}));
vi.mock("../ai/aiHelpers", () => ({
	resolveModel: vi.fn(() => ({
		model: { name: "test-model", maxTokens: 1000 },
		provider: { name: "TestProvider", endpoint: "", models: [] },
	})),
}));
vi.mock("../ai/Provider", () => ({
	activeModelRef: vi.fn(() => undefined),
}));
vi.mock("../ai/providerSecrets", () => ({
	resolveProviderApiKey: vi.fn(async () => "test-key"),
}));

import type { App } from "obsidian";
import { MacroChoiceEngine } from "./MacroChoiceEngine";
import { CommandType } from "../types/macros/CommandType";
import type { IAIAssistantCommand } from "../types/macros/QuickCommands/IAIAssistantCommand";
import type { IMacro } from "../types/macros/IMacro";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type { IChoiceExecutor } from "../IChoiceExecutor";

function createEngine() {
	const app = {} as unknown as App;
	const plugin = {
		getChoiceById: vi.fn(),
		getChoiceByName: vi.fn(),
	} as never;

	const command: IAIAssistantCommand = {
		id: "ai-cmd-1",
		name: "AI Assistant",
		type: CommandType.AIAssistant,
		model: "test-model",
		systemPrompt: "You are helpful.",
		outputVariableName: "output",
		promptTemplate: { enable: false, name: "" },
		modelParameters: {},
	};

	const macro: IMacro = {
		name: "Test macro",
		id: "macro-id",
		commands: [command],
	};

	const choice: IMacroChoice = {
		name: "Summarize note",
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

	return new MacroChoiceEngine(
		app,
		plugin,
		choice,
		choiceExecutor,
		new Map<string, unknown>()
	);
}

describe("MacroChoiceEngine executeAIAssistant prompt run context (#1621)", () => {
	beforeEach(() => {
		runAIAssistantMock.mockClear();
		setPromptRunContextMock.mockClear();
	});

	it("hands the AI command's formatter the choice name and a per-command draft scope", async () => {
		const engine = createEngine();

		await engine.run();

		expect(runAIAssistantMock).toHaveBeenCalledTimes(1);
		expect(setPromptRunContextMock).toHaveBeenCalledWith({
			choiceName: "Summarize note",
			draftScopeId: "choice-id#aiAssistant:ai-cmd-1",
		});
	});
});
