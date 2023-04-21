import { Modal, Setting, TextAreaComponent } from "obsidian";
import type { Models_And_Ask_Me } from "src/ai/models";
import { models_and_ask_me } from "src/ai/models";
import type { QuickAddSettings } from "src/quickAddSettingsTab";
import { setPasswordOnBlur } from "src/utils/setPasswordOnBlur";
import { FormatSyntaxSuggester } from "./suggesters/formatSyntaxSuggester";
import QuickAdd from "src/main";
import { FormatDisplayFormatter } from "src/formatters/formatDisplayFormatter";

type AIAssistantSettings = QuickAddSettings["ai"];

export class AIAssistantSettingsModal extends Modal {
	public waitForClose: Promise<AIAssistantSettings>;

	private resolvePromise: (settings: AIAssistantSettings) => void;
	private rejectPromise: (reason?: unknown) => void;

	private settings: AIAssistantSettings;

	constructor(settings: AIAssistantSettings) {
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
		this.contentEl.createEl("h2", {
			text: "AI Assistant Settings",
		}).style.textAlign = "center";

		this.addApiKeySetting(this.contentEl);
		this.addDefaultModelSetting(this.contentEl);
		this.addPromptTemplateFolderPathSetting(this.contentEl);
		this.addShowAssistantSetting(this.contentEl);

		this.addDefaultSystemPromptSetting(this.contentEl);
	}

	private reload(): void {
		this.contentEl.empty();

		this.display();
	}

	addApiKeySetting(container: HTMLElement) {
		new Setting(container)
			.setName("API Key")
			.setDesc("The API Key for the AI Assistant")
			.addText((text) => {
				setPasswordOnBlur(text.inputEl);
				text.setValue(this.settings.OpenAIApiKey).onChange((value) => {
					this.settings.OpenAIApiKey = value;
				});

				text.inputEl.placeholder = "sk-...";
			});
	}

	addDefaultModelSetting(container: HTMLElement) {
		new Setting(container)
			.setName("Default Model")
			.setDesc("The default model for the AI Assistant")
			.addDropdown((dropdown) => {
				for (const model of models_and_ask_me) {
					dropdown.addOption(model, model);
				}

				dropdown.setValue(this.settings.defaultModel);
				dropdown.onChange((value) => {
					this.settings.defaultModel = value as Models_And_Ask_Me;
				});
			});
	}

	addPromptTemplateFolderPathSetting(container: HTMLElement) {
		new Setting(container)
			.setName("Prompt Template Folder Path")
			.setDesc("Path to your folder with prompt templates")
			.addText((text) => {
				text.setValue(this.settings.promptTemplatesFolderPath).onChange(
					(value) => {
						this.settings.promptTemplatesFolderPath = value;
					}
				);
			});
	}

	addShowAssistantSetting(container: HTMLElement) {
		new Setting(container)
			.setName("Show Assistant")
			.setDesc("Show status messages from the AI Assistant")
			.addToggle((toggle) => {
				toggle.setValue(this.settings.showAssistant);
				toggle.onChange((value) => {
					this.settings.showAssistant = value;
				});
			});
	}

	addDefaultSystemPromptSetting(contentEl: HTMLElement) {
		new Setting(contentEl)
			.setName("Default System Prompt")
			.setDesc("The default system prompt for the AI Assistant");

		const textAreaComponent = new TextAreaComponent(contentEl);
		textAreaComponent
			.setValue(this.settings.defaultSystemPrompt)
			.onChange(async (value) => {
				this.settings.defaultSystemPrompt = value;

				formatDisplay.innerText = await displayFormatter.format(value);
			});

		new FormatSyntaxSuggester(
			this.app,
			textAreaComponent.inputEl,
			QuickAdd.instance
		);
		const displayFormatter = new FormatDisplayFormatter(
			this.app,
			QuickAdd.instance
		);

		textAreaComponent.inputEl.style.width = "100%";
		textAreaComponent.inputEl.style.height = "100px";
		textAreaComponent.inputEl.style.marginBottom = "1em";

		const formatDisplay = this.contentEl.createEl("span");

		void (async () =>
			(formatDisplay.innerText = await displayFormatter.format(
				this.settings.defaultSystemPrompt ?? ""
			)))();
	}

    onClose(): void {
        this.resolvePromise(this.settings);
        super.onClose();
    }
}
