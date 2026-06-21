import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("obsidian-dataview", () => ({
	getAPI: vi.fn(),
}));
vi.mock("src/settingsStore", () => ({
	settingsStore: {
		getState: () => ({
			ai: { promptTemplatesFolderPath: "", showAssistant: false },
			disableOnlineFeatures: false,
		}),
	},
}));
vi.mock("src/quickAddInstance", () => ({
	getQuickAddInstance: vi.fn(() => ({})),
}));
vi.mock("src/ai/aiHelpers", () => ({
	getModelNames: vi.fn(() => ["gpt-test"]),
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

function makeCommand(model: string): IAIAssistantCommand {
	return {
		id: "ai-1",
		name: "AI Assistant",
		type: "AIAssistant",
		model,
		systemPrompt: "original prompt",
		outputVariableName: "output",
		modelParameters: { temperature: 0.5 },
		promptTemplate: { enable: false, name: "" },
	} as IAIAssistantCommand;
}

// The Model dropdown is the only <select> rendered by the modal whose options
// come from getModelNames() plus "Ask me".
function getModelSelect(
	modal: AIAssistantCommandSettingsModal
): HTMLSelectElement {
	const select = Array.from(
		modal.contentEl.querySelectorAll<HTMLSelectElement>("select")
	).find((candidate) =>
		Array.from(candidate.options).some((opt) => opt.value === "Ask me")
	);
	if (!select) throw new Error("Model dropdown not found");
	return select;
}

// Finding: ai-assistant-default-model-setting — the per-command Model dropdown
// silently fell back to the first option (and persisted the wrong default) when
// the pinned model had been deleted. It must now surface the stale value with a
// "(missing)" option so the dropdown reflects the saved selection.
describe("AIAssistantCommandSettingsModal Model dropdown missing-model handling", () => {
	beforeAll(() => {
		const modalProto = Object.getPrototypeOf(
			AIAssistantCommandSettingsModal.prototype
		) as { onClose?: () => void };
		modalProto.onClose ??= function onClose() {};
	});

	it("adds a disabled (missing) option and selects it when the stored model is gone", () => {
		const command = makeCommand("deleted-model");
		const modal = new AIAssistantCommandSettingsModal(testApp(), command);

		const select = getModelSelect(modal);
		const missing = Array.from(select.options).find(
			(opt) => opt.value === "deleted-model"
		);

		expect(missing).toBeDefined();
		expect(missing?.textContent).toBe("(missing) deleted-model");
		// The dropdown reflects the stored value instead of silently defaulting.
		expect(select.value).toBe("deleted-model");

		modal.close();
	});

	it("does not add a (missing) option when the stored model still exists", () => {
		const command = makeCommand("gpt-test");
		const modal = new AIAssistantCommandSettingsModal(testApp(), command);

		const select = getModelSelect(modal);
		const labels = Array.from(select.options).map((opt) => opt.textContent);

		expect(labels).not.toContain("(missing) gpt-test");
		expect(select.value).toBe("gpt-test");

		modal.close();
	});

	it("does not add a (missing) option for the 'Ask me' sentinel", () => {
		const command = makeCommand("Ask me");
		const modal = new AIAssistantCommandSettingsModal(testApp(), command);

		const select = getModelSelect(modal);
		const labels = Array.from(select.options).map((opt) => opt.textContent);

		expect(labels.filter((label) => label === "Ask me")).toHaveLength(1);
		expect(labels.some((label) => label?.startsWith("(missing)"))).toBe(
			false
		);
		expect(select.value).toBe("Ask me");

		modal.close();
	});
});
