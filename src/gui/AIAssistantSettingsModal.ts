import type { App } from "obsidian";
import { Modal, Setting, TextAreaComponent } from "obsidian";
import type { QuickAddSettings } from "src/settings";
import { mountSystemPromptLiteralNote } from "./ai/systemPromptLiteralNote";
import { AIAssistantProvidersModal } from "./AIAssistantProvidersModal";
import { populateModelDropdown } from "./modelSelect";
import { GenericTextSuggester } from "./suggesters/genericTextSuggester";
import { getAllFolderPathsInVault } from "src/utilityObsidian";

type AIAssistantSettings = QuickAddSettings["ai"];

export class AIAssistantSettingsModal extends Modal {
	public waitForClose: Promise<AIAssistantSettings>;

	private resolvePromise: (settings: AIAssistantSettings) => void;
	private rejectPromise: (reason?: unknown) => void;

	private settings: AIAssistantSettings;

	constructor(app: App, settings: AIAssistantSettings) {
		super(app);

		this.settings = settings;

		this.waitForClose = new Promise<AIAssistantSettings>(
			(resolve, reject) => {
				this.rejectPromise = reject;
				this.resolvePromise = resolve;
			}
		);

		this.open();
		this.display();
	}

	private display(): void {
		this.modalEl.addClass("qa-ai-wide-modal");
		this.contentEl.addClass("qa-ai-scroll-content");

		this.contentEl.createEl("h2", {
			text: "AI Assistant settings",
			cls: "qa-modal-title",
		});

		this.addProvidersSetting(this.contentEl);
		this.addDefaultModelSetting(this.contentEl);
		this.addPromptTemplateFolderPathSetting(this.contentEl);
		this.addShowAssistantSetting(this.contentEl);
		this.addConfirmToolCallsSetting(this.contentEl);

		this.addDefaultSystemPromptSetting(this.contentEl);
	}

	private reload(): void {
		this.contentEl.empty();

		this.display();
	}

	addProvidersSetting(container: HTMLElement) {
		new Setting(container)
			.setName("Providers")
			.setDesc("The providers for the AI Assistant")
			.addButton((button) => {
				button.setButtonText("Edit providers").onClick(() => {
					void new AIAssistantProvidersModal(
						this.settings.providers,
						this.app
					).waitForClose.then(() => {
						this.reload();
					});
				});
			});
	}
 
	addDefaultModelSetting(container: HTMLElement) {
		new Setting(container)
			.setName("Default model")
			.setDesc("The default model for the AI Assistant")
			.addDropdown((dropdown) => {
				populateModelDropdown(
					dropdown,
					{
						model: this.settings.defaultModel,
						modelRef: this.settings.defaultModelRef,
					},
					(selection) => {
						this.settings.defaultModel = selection.model;
						this.settings.defaultModelRef = selection.modelRef;
					},
				);
			});
	}

	addPromptTemplateFolderPathSetting(container: HTMLElement) {
		new Setting(container)
			.setName("Prompt template folder path")
			.setDesc("Path to your folder with prompt templates")
			.addText((text) => {
				text.setValue(this.settings.promptTemplatesFolderPath).onChange(
					(value) => {
						this.settings.promptTemplatesFolderPath = value;
					}
				);

				new GenericTextSuggester(
					this.app,
					text.inputEl,
					getAllFolderPathsInVault(this.app)
				);
			});
	}

	addShowAssistantSetting(container: HTMLElement) {
		new Setting(container)
			.setName("Show assistant")
			.setDesc("Show status messages from the AI Assistant")
			.addToggle((toggle) => {
				toggle.setValue(this.settings.showAssistant);
				toggle.onChange((value) => {
					this.settings.showAssistant = value;
				});
			});
	}

	addConfirmToolCallsSetting(container: HTMLElement) {
		new Setting(container)
			.setName("Confirm AI tool calls")
			.setDesc(
				"When an AI agent runs script-defined or built-in tools, ask before executing. 'Destructive only' confirms tools not marked read-only; 'Always' confirms every tool; 'Never' defers to each tool's own setting. A tool that requires approval is always confirmed regardless.",
			)
			.addDropdown((dropdown) => {
				dropdown.addOption("destructive", "Destructive tools only (recommended)");
				dropdown.addOption("always", "Always confirm every tool");
				dropdown.addOption("never", "Never (use each tool's own setting)");
				dropdown.setValue(this.settings.confirmToolCalls ?? "destructive");
				dropdown.onChange((value) => {
					this.settings.confirmToolCalls =
						value as QuickAddSettings["ai"]["confirmToolCalls"];
				});
			});
	}

	addDefaultSystemPromptSetting(contentEl: HTMLElement) {
		new Setting(contentEl)
			.setName("Default system prompt")
			.setDesc("The default system prompt for the AI Assistant");

		const textAreaComponent = new TextAreaComponent(contentEl);
		textAreaComponent.inputEl.addClass("qa-ai-prompt-textarea");
		// The textarea is appended to contentEl rather than to the Setting's
		// controlEl (it needs the full modal width), so nothing associates it with
		// the "Default system prompt" name above.
		textAreaComponent.inputEl.setAttribute(
			"aria-label",
			"Default system prompt",
		);

		// No format preview and no `{{` token autocomplete here: the system prompt
		// is sent to the model verbatim (see mountSystemPromptLiteralNote). The
		// preview this replaces resolved the tokens on screen and was, for the
		// shipped token-free default, a character-for-character duplicate of the
		// textarea above it (#1568).
		const updateLiteralNote = mountSystemPromptLiteralNote(
			contentEl,
			textAreaComponent.inputEl,
			this.settings.defaultSystemPrompt ?? "",
		);

		textAreaComponent
			.setValue(this.settings.defaultSystemPrompt)
			.onChange((value) => {
				this.settings.defaultSystemPrompt = value;
				updateLiteralNote(value);
			});
	}

	onClose(): void {
		this.resolvePromise(this.settings);
		super.onClose();
	}
}
