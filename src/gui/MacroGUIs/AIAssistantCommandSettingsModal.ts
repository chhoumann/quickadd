import { Modal, Setting, TextAreaComponent } from "obsidian";
import type { Models_And_Ask_Me } from "src/ai/models";
import { models_and_ask_me } from "src/ai/models";
import { FormatSyntaxSuggester } from "./../suggesters/formatSyntaxSuggester";
import QuickAdd from "src/main";
import { FormatDisplayFormatter } from "src/formatters/formatDisplayFormatter";
import type { IAIAssistantCommand } from "src/types/macros/QuickCommands/IAIAssistantCommand";
import { GenericTextSuggester } from "../suggesters/genericTextSuggester";
import { getMarkdownFilesInFolder } from "src/utilityObsidian";
import { settingsStore } from "src/settingsStore";
import GenericInputPrompt from "../GenericInputPrompt/GenericInputPrompt";

export class AIAssistantCommandSettingsModal extends Modal {
	public waitForClose: Promise<IAIAssistantCommand>;

	private resolvePromise: (settings: IAIAssistantCommand) => void;
	private rejectPromise: (reason?: unknown) => void;

	private settings: IAIAssistantCommand;

	constructor(settings: IAIAssistantCommand) {
		super(app);

		this.settings = settings;

		this.waitForClose = new Promise<IAIAssistantCommand>(
			(resolve, reject) => {
				this.rejectPromise = reject;
				this.resolvePromise = resolve;
			}
		);

		this.open();
		this.display();
	}

	private display(): void {
		const header = this.contentEl.createEl("h2", {
			text: `${this.settings.name} Settings`,
		});

		header.style.textAlign = "center";
        header.style.cursor = "pointer";
        header.style.userSelect = "none";
		// eslint-disable-next-line @typescript-eslint/no-misused-promises
		header.addEventListener("click", async () => {
			try {
				const newName = await GenericInputPrompt.Prompt(
					app,
					"New name",
                    this.settings.name,
                    this.settings.name
				);

				if (newName && newName !== this.settings.name) {
					this.settings.name = newName;
					this.reload();
				}
			} catch (error) {} // no new name, don't need exceptional state for that
		});

		this.addPromptTemplateSetting(this.contentEl);
		this.addModelSetting(this.contentEl);
		this.addOutputVariableNameSetting(this.contentEl);

		this.addSystemPromptSetting(this.contentEl);
	}

	private reload(): void {
		this.contentEl.empty();

		this.display();
	}

	addPromptTemplateSetting(container: HTMLElement) {
		const promptTemplatesFolder =
			settingsStore.getState().ai.promptTemplatesFolderPath;
		const promptTemplateFiles = getMarkdownFilesInFolder(
			promptTemplatesFolder
		).map((f) => f.name);

		new Setting(container)
			.setName("Prompt Template")
			.setDesc(
				"Enabling this will have the assistant use the prompt template you specify. If disable, the assistant will ask you for a prompt template to use."
			)
			.addToggle((toggle) => {
				toggle.setValue(this.settings.promptTemplate.enable);
				toggle.onChange((value) => {
					this.settings.promptTemplate.enable = value;
				});
			})
			.addText((text) => {
				text.setValue(this.settings.promptTemplate.name).onChange(
					(value) => {
						this.settings.promptTemplate.name = value;
					}
				);

				new GenericTextSuggester(
					app,
					text.inputEl,
					promptTemplateFiles
				);
			});
	}

	addModelSetting(container: HTMLElement) {
		new Setting(container)
			.setName("Model")
			.setDesc("The model the AI Assistant will use")
			.addDropdown((dropdown) => {
				for (const model of models_and_ask_me) {
					dropdown.addOption(model, model);
				}

				dropdown.setValue(this.settings.model);
				dropdown.onChange((value) => {
					this.settings.model = value as Models_And_Ask_Me;
				});
			});
	}

	addOutputVariableNameSetting(container: HTMLElement) {
		new Setting(container)
			.setName("Output variable name")
			.setDesc(
				"The name of the variable used to store the AI Assistant output, i.e. {{value:output}}."
			)
			.addText((text) => {
				text.setValue(this.settings.outputVariableName).onChange(
					(value) => {
						this.settings.outputVariableName = value;
					}
				);
			});
	}

	addSystemPromptSetting(contentEl: HTMLElement) {
		new Setting(contentEl)
			.setName("System Prompt")
			.setDesc("The system prompt for the AI Assistant");

		const textAreaComponent = new TextAreaComponent(contentEl);
		textAreaComponent
			.setValue(this.settings.systemPrompt)
			.onChange(async (value) => {
				this.settings.systemPrompt = value;

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
				this.settings.systemPrompt ?? ""
			)))();
	}

	onClose(): void {
		this.resolvePromise(this.settings);
		super.onClose();
	}
}
