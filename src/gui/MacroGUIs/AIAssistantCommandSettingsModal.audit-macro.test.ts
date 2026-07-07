import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("obsidian-dataview", () => ({
	getAPI: vi.fn(),
}));
vi.mock("src/settingsStore", () => ({
	settingsStore: {
		getState: () => ({
			ai: {
				promptTemplatesFolderPath: "",
				showAssistant: false,
				providers: [
					{
						id: "test",
						name: "TestProvider",
						endpoint: "https://example.test/v1",
						apiKey: "",
						models: [{ name: "gpt-test", maxTokens: 1000 }],
						modelSource: "providerApi",
					},
				],
			},
			disableOnlineFeatures: false,
		}),
	},
}));
vi.mock("src/quickAddInstance", () => ({
	getQuickAddInstance: vi.fn(() => ({})),
}));
vi.mock("src/utilityObsidian", () => ({
	getMarkdownFilesInFolder: vi.fn(() => []),
}));
vi.mock("src/ai/tokenEstimator", () => ({
	estimateTokenCount: vi.fn(() => 0),
}));
vi.mock("./../suggesters/formatSyntaxSuggester", () => ({
	FormatSyntaxSuggester: class {},
}));
vi.mock("../suggesters/genericTextSuggester", () => ({
	GenericTextSuggester: class {},
}));
vi.mock("src/formatters/formatDisplayFormatter", () => ({
	FormatDisplayFormatter: class {
		async format(input: string) {
			return input;
		}
	},
}));

import { App } from "obsidian";
import { fireEvent } from "@testing-library/svelte";
import type { IAIAssistantCommand } from "src/types/macros/QuickCommands/IAIAssistantCommand";
import { AIAssistantCommandSettingsModal } from "./AIAssistantCommandSettingsModal";

function testApp(): App {
	const app = new App() as App & {
		dom: { appContainerEl: HTMLElement };
		keymap: { pushScope: () => void; popScope: () => void };
	};
	app.dom = { appContainerEl: document.body };
	app.keymap = { pushScope: vi.fn(), popScope: vi.fn() };
	return app;
}

function makeCommand(): IAIAssistantCommand {
	return {
		id: "ai-1",
		name: "AI Assistant",
		type: "AIAssistant",
		model: "gpt-test",
		systemPrompt: "original prompt",
		outputVariableName: "output",
		modelParameters: { temperature: 0.5 },
		promptTemplate: { enable: false, name: "" },
	} as IAIAssistantCommand;
}

function getButton(
	modal: AIAssistantCommandSettingsModal,
	text: string
): HTMLButtonElement {
	const button = Array.from(
		modal.containerEl.querySelectorAll<HTMLButtonElement>("button")
	).find((candidate) => candidate.textContent === text);
	if (!button) throw new Error(`${text} button not found`);
	return button;
}

describe("AIAssistantCommandSettingsModal cancel/discard semantics", () => {
	beforeAll(() => {
		const modalProto = Object.getPrototypeOf(
			AIAssistantCommandSettingsModal.prototype
		) as { onClose?: () => void };
		modalProto.onClose ??= function onClose() {};
	});

	it("discards in-session edits and resolves null on Cancel", async () => {
		const command = makeCommand();
		const modal = new AIAssistantCommandSettingsModal(testApp(), command);
		const result = modal.waitForClose;

		// Simulate edits made through the modal (it mutates the live command).
		command.systemPrompt = "edited prompt";
		command.modelParameters.temperature = 0.9;

		await fireEvent.click(getButton(modal, "Cancel"));

		await expect(result).resolves.toBeNull();
		// The live command is restored to its opened state.
		expect(command.systemPrompt).toBe("original prompt");
		expect(command.modelParameters.temperature).toBe(0.5);
	});

	it("commits edits and resolves the command on Save", async () => {
		const command = makeCommand();
		const modal = new AIAssistantCommandSettingsModal(testApp(), command);
		const result = modal.waitForClose;

		command.systemPrompt = "edited prompt";

		await fireEvent.click(getButton(modal, "Save"));

		const resolved = await result;
		expect(resolved).not.toBeNull();
		expect(command.systemPrompt).toBe("edited prompt");
	});

	it("discards edits and resolves null when dismissed without Save (Esc)", async () => {
		const command = makeCommand();
		const modal = new AIAssistantCommandSettingsModal(testApp(), command);
		const result = modal.waitForClose;

		command.systemPrompt = "edited prompt";

		modal.close();

		await expect(result).resolves.toBeNull();
		expect(command.systemPrompt).toBe("original prompt");
	});
});
