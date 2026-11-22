// @vitest-environment jsdom
import { testApp } from "../../../tests/helpers/settings/modalApp";
import { describe, expect, it, vi } from "vitest";

const suggesters = vi.hoisted(() => ({ live: 0 }));

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
						models: [
							{ name: "gpt-test", maxTokens: 1000 },
							{ name: "gpt-other", maxTokens: 1000 },
						],
						modelSource: "providerApi",
					},
				],
			},
			disableOnlineFeatures: false,
		}),
	},
}));
vi.mock("src/utils/vaultQueries", () => ({
	getMarkdownFilesInFolder: vi.fn(() => []),
}));
vi.mock("src/ai/tokenEstimator", () => ({
	estimateTokenCount: vi.fn(() => 0),
}));
vi.mock("../suggesters/genericTextSuggester", () => ({
	GenericTextSuggester: class {
		constructor() {
			suggesters.live++;
		}
		destroy(): void {
			suggesters.live--;
		}
	},
}));

import { fireEvent } from "@testing-library/svelte";
import type { IAIAssistantCommand } from "src/types/macros/QuickCommands/IAIAssistantCommand";
import { AIAssistantCommandSettingsModal } from "./AIAssistantCommandSettingsModal";


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

function editSystemPrompt(modal: AIAssistantCommandSettingsModal, value: string): Promise<boolean> {
	return fireEvent.input(modal.contentEl.querySelector("textarea")!, { target: { value } });
}

describe("AIAssistantCommandSettingsModal cancel/discard semantics", () => {
	it("keeps the command unchanged and resolves null on Cancel", async () => {
		const command = makeCommand();
		const modal = new AIAssistantCommandSettingsModal(testApp(), command);
		const result = modal.waitForClose;

		await editSystemPrompt(modal, "edited prompt");
		await fireEvent.click(getButton(modal, "Cancel"));

		await expect(result).resolves.toBeNull();
		expect(command.systemPrompt).toBe("original prompt");
	});

	it("resolves the edited command on Save", async () => {
		const command = makeCommand();
		const modal = new AIAssistantCommandSettingsModal(testApp(), command);
		const result = modal.waitForClose;

		await editSystemPrompt(modal, "edited prompt");
		await fireEvent.click(getButton(modal, "Save"));

		await expect(result).resolves.toMatchObject({ id: "ai-1", systemPrompt: "edited prompt" });
	});

	it("keeps the command unchanged and resolves null when dismissed without Save (Esc)", async () => {
		const command = makeCommand();
		const modal = new AIAssistantCommandSettingsModal(testApp(), command);
		const result = modal.waitForClose;

		await editSystemPrompt(modal, "edited prompt");
		modal.close();

		await expect(result).resolves.toBeNull();
		expect(command.systemPrompt).toBe("original prompt");
	});

	it("leaves a legacy command without a model ref untouched when a new model is picked and cancelled", async () => {
		const command = makeCommand();
		expect(command).not.toHaveProperty("modelRef");
		const modal = new AIAssistantCommandSettingsModal(testApp(), command);
		const result = modal.waitForClose;

		const select = modal.contentEl.querySelector<HTMLSelectElement>("select")!;
		const other = [...select.options].find((option) => option.textContent === "gpt-other")!;
		await fireEvent.change(select, { target: { value: other.value } });
		await fireEvent.click(getButton(modal, "Cancel"));

		await expect(result).resolves.toBeNull();
		expect(command.modelRef).toBeUndefined();
		expect(command.model).toBe("gpt-test");
	});

	it("tears down the prompt template suggester on re-render and close", async () => {
		const live = suggesters.live;
		const modal = new AIAssistantCommandSettingsModal(testApp(), makeCommand());
		expect(suggesters.live - live).toBe(1);

		const advanced = modal.contentEl.querySelectorAll<HTMLInputElement>("input[type=checkbox]")[1];
		if (!advanced) throw new Error("Missing Show advanced settings toggle");
		await fireEvent.click(advanced);
		expect(suggesters.live - live, "re-render leaked the suggester").toBe(1);

		modal.close();
		expect(suggesters.live - live, "close leaked the suggester").toBe(0);
	});
});
