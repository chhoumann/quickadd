import type { App } from "obsidian";
import { Modal, Setting, TextAreaComponent } from "obsidian";
import type { QuickAddSettings } from "src/quickAddSettingsTab";
import { FormatSyntaxSuggester } from "./suggesters/formatSyntaxSuggester";
import QuickAdd from "src/main";
import { FormatDisplayFormatter } from "src/formatters/formatDisplayFormatter";
import { AIAssistantProvidersModal } from "./AIAssistantProvidersModal";
import { getModelNames } from "src/ai/aiHelpers";

type AIAssistantSettings = QuickAddSettings["ai"];

export class AIAssistantSettingsModal extends Modal {
	public waitForClose: Promise<AIAssistantSettings>;

	private resolvePromise: (settings: AIAssistantSettings) => void;

	private settings: AIAssistantSettings;

	constructor(app: App, settings: AIAssistantSettings) {
		super(app);

		this.settings = settings;

		this.waitForClose = new Promise<AIAssistantSettings>((resolve, reject) => {
			this.rejectPromise = reject;
			this.resolvePromise = resolve;
		});

		this.open();
		this.display();
	}

	private display(): void {
		// Responsive sizing (desktop and mobile)
		this.modalEl.style.width = `min(100vw - 32px, 980px)`;
		this.modalEl.style.maxWidth = `980px`;
		this.contentEl.style.maxHeight = `min(85vh, 800px)`;
		this.contentEl.style.overflowY = "auto";

		this.contentEl.createEl("h2", {
			text: "AI Assistant Settings",
		}).style.textAlign = "center";

		this.addProvidersSetting(this.contentEl);
		this.addDefaultModelSetting(this.contentEl);
		this.addPromptTemplateFolderPathSetting(this.contentEl);
		this.addShowAssistantSetting(this.contentEl);

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
				button.setButtonText("Edit Providers").onClick(() => {
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
			.setName("Default Model")
			.setDesc("The default model for the AI Assistant")
			.addDropdown((dropdown) => {
				const models = getModelNames();
				for (const model of models) {
					dropdown.addOption(model, model);
				}

				dropdown.addOption("Ask me", "Ask me");

				dropdown.setValue(this.settings.defaultModel);
				dropdown.onChange((value) => {
					this.settings.defaultModel = value;
				});
			});
	}

	addPromptTemplateFolderPathSetting(container: HTMLElement) {
		new Setting(container)
			.setName("Prompt Template Folder Path")
			.setDesc("Path to your folder with prompt templates")
			.addText((text) => {
				text
					.setValue(this.settings.promptTemplatesFolderPath)
					.onChange((value) => {
						this.settings.promptTemplatesFolderPath = value;
					});
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
		textAreaComponent.inputEl.style.minHeight = "100px";
		textAreaComponent.inputEl.style.marginBottom = "1em";

		const formatDisplay = this.contentEl.createEl("span");

		void (async () => {
			formatDisplay.innerText = await displayFormatter.format(
				this.settings.defaultSystemPrompt ?? ""
			);
		})();
	}

	onClose(): void {
		this.resolvePromise(this.settings);
		super.onClose();
	}
}
