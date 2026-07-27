import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Both system-prompt modals must not offer a format affordance: the system
 * prompt reaches the model verbatim (pinned by
 * AIAssistant.systemPromptLiteral.test.ts), so a live preview resolving its
 * tokens asserted a substitution that never happens (#1565), and on the shipped
 * token-free default it was a character-for-character duplicate of the textarea
 * above it (#1568).
 *
 * The two mocks below are the load-bearing assertions: they COUNT construction.
 * A test that only queried the DOM would keep passing if someone reinstated the
 * formatter but rendered it somewhere new.
 */

const mocks = vi.hoisted(() => ({
	formatDisplayFormatter: vi.fn(),
	formatSyntaxSuggester: vi.fn(),
}));

vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));
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
	getAllFolderPathsInVault: vi.fn(() => []),
}));
// Partial: the rest of tokenEstimator stays real, so only the count the
// command modal renders is stubbed.
vi.mock("src/ai/tokenEstimator", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	estimateTokenCount: vi.fn(() => 0),
}));
vi.mock("src/gui/suggesters/genericTextSuggester", () => ({
	GenericTextSuggester: class {},
}));
vi.mock("src/formatters/formatDisplayFormatter", () => ({
	FormatDisplayFormatter: class {
		constructor(...args: unknown[]) {
			mocks.formatDisplayFormatter(...args);
		}
		async format(input: string) {
			return input;
		}
	},
}));
vi.mock("src/gui/suggesters/formatSyntaxSuggester", () => ({
	FormatSyntaxSuggester: class {
		constructor(...args: unknown[]) {
			mocks.formatSyntaxSuggester(...args);
		}
	},
}));

import { App } from "obsidian";
import type { IAIAssistantCommand } from "src/types/macros/QuickCommands/IAIAssistantCommand";
import type { QuickAddSettings } from "src/settings";
import { AIAssistantSettingsModal } from "src/gui/AIAssistantSettingsModal";
import { AIAssistantCommandSettingsModal } from "src/gui/MacroGUIs/AIAssistantCommandSettingsModal";

const PROSE_PROMPT = "As an AI assistant within Obsidian, help the user.";
const TOKENED_PROMPT = "Today is {{DATE}}. Help the user.";

function testApp(): App {
	const app = new App() as App & {
		dom: { appContainerEl: HTMLElement };
		keymap: { pushScope: () => void; popScope: () => void };
	};
	app.dom = { appContainerEl: document.body };
	app.keymap = { pushScope: vi.fn(), popScope: vi.fn() };
	return app;
}

function aiSettings(defaultSystemPrompt: string): QuickAddSettings["ai"] {
	return {
		defaultModel: "gpt-test",
		defaultSystemPrompt,
		promptTemplatesFolderPath: "",
		showAssistant: false,
		providers: [],
	} as unknown as QuickAddSettings["ai"];
}

function aiCommand(systemPrompt: string): IAIAssistantCommand {
	return {
		id: "ai-1",
		name: "AI Assistant",
		type: "AIAssistant",
		model: "gpt-test",
		systemPrompt,
		outputVariableName: "output",
		modelParameters: {},
		promptTemplate: { enable: false, name: "" },
	} as IAIAssistantCommand;
}

interface OpenedModal {
	contentEl: HTMLElement;
	/** Every one of these modals re-renders in place; the AI settings modal does
	 *  it on every "Edit providers", the command modals on every model change. */
	reload: () => void;
	close: () => void;
	label: string;
}

function opened(
	modal: { contentEl: HTMLElement; close: () => void },
	label: string,
): OpenedModal {
	return {
		contentEl: modal.contentEl,
		reload: () => (modal as unknown as { reload: () => void }).reload(),
		close: () => modal.close(),
		label,
	};
}

/** Each modal, paired with a factory that opens it. */
const MODALS: Array<{
	name: string;
	open: (systemPrompt: string) => OpenedModal;
}> = [
	{
		name: "AIAssistantSettingsModal (default system prompt)",
		open: (systemPrompt) =>
			opened(
				new AIAssistantSettingsModal(testApp(), aiSettings(systemPrompt)),
				"Default system prompt",
			),
	},
	{
		name: "AIAssistantCommandSettingsModal (system prompt)",
		open: (systemPrompt) =>
			opened(
				new AIAssistantCommandSettingsModal(testApp(), aiCommand(systemPrompt)),
				"System prompt",
			),
	},
];

function promptTextarea(contentEl: HTMLElement): HTMLTextAreaElement {
	const textarea = contentEl.querySelector<HTMLTextAreaElement>(
		"textarea.qa-ai-prompt-textarea",
	);
	if (!textarea) throw new Error("System prompt textarea not found");
	return textarea;
}

describe("AI system-prompt fields offer no format affordance", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		document.body.innerHTML = "";
	});

	for (const { name, open } of MODALS) {
		describe(name, () => {
			it("builds no preview formatter and no token autocomplete", () => {
				const { contentEl, close } = open(PROSE_PROMPT);

				expect(mocks.formatDisplayFormatter).not.toHaveBeenCalled();
				expect(mocks.formatSyntaxSuggester).not.toHaveBeenCalled();
				// #1568: no bare span echoing the prompt back under the field.
				expect(contentEl.textContent).not.toContain(PROSE_PROMPT);
				expect(promptTextarea(contentEl).value).toBe(PROSE_PROMPT);

				close();
			});

			it("stays quiet for a prose prompt and explains itself once a token appears", () => {
				const { contentEl, close } = open(PROSE_PROMPT);
				const note = contentEl.querySelector(".qa-literal-format-note");
				expect(note).not.toBeNull();
				expect(
					note?.classList.contains("qa-literal-format-note--shown"),
				).toBe(false);

				const textarea = promptTextarea(contentEl);
				textarea.value = TOKENED_PROMPT;
				textarea.dispatchEvent(new Event("input", { bubbles: true }));

				expect(
					note?.classList.contains("qa-literal-format-note--shown"),
				).toBe(true);

				close();
			});

			it("shows the note immediately when the stored prompt already has a token", () => {
				const { contentEl, close } = open(TOKENED_PROMPT);

				expect(
					contentEl
						.querySelector(".qa-literal-format-note")
						?.classList.contains("qa-literal-format-note--shown"),
				).toBe(true);

				close();
			});

			it("names the textarea, which sits outside its Setting row", () => {
				const { contentEl, close, label } = open(PROSE_PROMPT);

				expect(promptTextarea(contentEl).getAttribute("aria-label")).toBe(
					label,
				);

				close();
			});

			it("keeps exactly one note, still correct, across a reload", () => {
				// reload() empties contentEl and rebuilds. A note hoisted out of the
				// field's own builder would survive the first render and vanish here,
				// silently taking the field's last remaining signal with it.
				const { contentEl, close, reload } = open(TOKENED_PROMPT);
				reload();

				const notes = contentEl.querySelectorAll(".qa-literal-format-note");
				expect(notes).toHaveLength(1);
				expect(
					notes[0].classList.contains("qa-literal-format-note--shown"),
				).toBe(true);
				expect(promptTextarea(contentEl).getAttribute("aria-describedby")).toBe(
					notes[0].id,
				);
				expect(mocks.formatDisplayFormatter).not.toHaveBeenCalled();
				expect(mocks.formatSyntaxSuggester).not.toHaveBeenCalled();

				close();
			});
		});
	}
});
