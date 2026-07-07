import type { App } from "obsidian";
import { ButtonComponent, Modal, Setting, TextAreaComponent, debounce } from "obsidian";
import { FormatSyntaxSuggester } from "./../suggesters/formatSyntaxSuggester";
import { getQuickAddInstance } from "src/quickAddInstance";
import { FormatDisplayFormatter } from "src/formatters/formatDisplayFormatter";
import type { IAIAssistantCommand } from "src/types/macros/QuickCommands/IAIAssistantCommand";
import { GenericTextSuggester } from "../suggesters/genericTextSuggester";
import { getMarkdownFilesInFolder } from "src/utilityObsidian";
import { settingsStore } from "src/settingsStore";
import GenericInputPrompt from "../GenericInputPrompt/GenericInputPrompt";
import { estimateTokenCount } from "src/ai/tokenEstimator";
import { addSamplingParamSettings } from "./samplingParamSettings";
import { populateModelDropdown } from "../modelSelect";
import { activeModelRef } from "src/ai/Provider";

export class AIAssistantCommandSettingsModal extends Modal {
	public waitForClose: Promise<IAIAssistantCommand | null>;

	private resolvePromise: (settings: IAIAssistantCommand | null) => void;
	private rejectPromise: (reason?: unknown) => void;

	private settings: IAIAssistantCommand;
	// Snapshot of the command as it was opened, so Cancel/Esc can restore the live
	// object (the same reference the caller persists) instead of committing edits.
	private readonly originalSettings: IAIAssistantCommand;
	private isResolved = false;
	private showAdvancedSettings = false;

	private get systemPromptTokenLength(): number {
		// The estimate is provider-agnostic, so it no longer depends on the model.
		return estimateTokenCount(this.settings.systemPrompt);
	}

	constructor(app: App, settings: IAIAssistantCommand) {
		super(app);

		this.settings = settings;
		this.originalSettings = this.cloneSettings(settings);

		this.waitForClose = new Promise<IAIAssistantCommand | null>(
			(resolve, reject) => {
				this.rejectPromise = reject;
				this.resolvePromise = resolve;
			}
		);

		this.open();
		this.display();
	}

	private resolve(value: IAIAssistantCommand | null) {
		if (this.isResolved) return;
		this.isResolved = true;
		this.resolvePromise(value);
	}

	// Proxy-safe deep clone of the editable fields. Avoids structuredClone, which
	// throws DataCloneError on a Svelte dev-mode $state proxy (the command passed in
	// is one such proxy when edited from the macro command list).
	private cloneSettings(settings: IAIAssistantCommand): IAIAssistantCommand {
		return {
			...settings,
			promptTemplate: { ...settings.promptTemplate },
			modelParameters: { ...settings.modelParameters },
		};
	}

	// Restore the live command (same reference the caller persists) to its opened
	// state so Cancel/Esc discards edits, including the nested objects.
	private restoreOriginal(): void {
		const snapshot = this.cloneSettings(this.originalSettings);
		Object.assign(this.settings, snapshot);
		this.settings.promptTemplate = snapshot.promptTemplate;
		this.settings.modelParameters = snapshot.modelParameters;
	}

	private display(): void {
		const header = this.contentEl.createEl("h2");
		header.addClass("qa-clickable-modal-title");

		// Rename affordance is a real <button> (keyboard operable: Enter/Space) inside
		// the heading, so the <h2> keeps its heading role for screen readers (#1250).
		const renameButton = header.createEl("button", {
			cls: "qa-rename-title-button",
			text: `${this.settings.name} Settings`,
			attr: { type: "button", "aria-label": `Rename ${this.settings.name}` },
		});

		renameButton.addEventListener("click", () => {
			void (async () => {
				try {
					const newName = await GenericInputPrompt.Prompt(
						this.app,
						"New name",
						this.settings.name,
						this.settings.name
					);

					if (newName && newName !== this.settings.name) {
						this.settings.name = newName;
						this.reload();
					}
				} catch {
					// No new name, so the modal keeps the current command name.
				}
			})();
		});

		this.addPromptTemplateSetting(this.contentEl);

		this.addModelSetting(this.contentEl);
		this.addOutputVariableNameSetting(this.contentEl);

		this.addShowAdvancedSettingsToggle(this.contentEl);

		if (this.showAdvancedSettings) {
			if (!this.settings.modelParameters)
				this.settings.modelParameters = {};
			addSamplingParamSettings(
				this.contentEl,
				this.settings.modelParameters,
				activeModelRef(this.settings.model, this.settings.modelRef) ??
					this.settings.model,
				() => this.reload()
			);
		}

		this.addSystemPromptSetting(this.contentEl);

		this.addButtonBar(this.contentEl);
	}

	private addButtonBar(container: HTMLElement): void {
		const buttonRow = container.createDiv({
			cls: "qa-command-button-row",
		});

		new ButtonComponent(buttonRow)
			.setButtonText("Cancel")
			.onClick(() => {
				// Dismissing via Cancel discards every edit made in this session.
				this.restoreOriginal();
				this.resolve(null);
				this.close();
			});

		new ButtonComponent(buttonRow)
			.setButtonText("Save")
			.setCta()
			.onClick(() => {
				this.resolve(this.settings);
				this.close();
			});
	}

	private reload(): void {
		this.contentEl.empty();

		this.display();
	}

	addPromptTemplateSetting(container: HTMLElement) {
		const promptTemplatesFolder =
			settingsStore.getState().ai.promptTemplatesFolderPath;
		const promptTemplateFiles = getMarkdownFilesInFolder(
			this.app,
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
					this.app,
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
				populateModelDropdown(dropdown, this.settings, (selection) => {
					this.settings.model = selection.model;
					this.settings.modelRef = selection.modelRef;

					this.reload();
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

		const container = this.contentEl.createEl("div");
		const tokenCount = container.createEl("span", {
			cls: "qa-ai-token-count",
		});
		const tokenCountNote = container.createEl("div", {
			text: "Estimated locally. Providers enforce exact context limits.",
			cls: "qa-ai-token-note",
		});

		container.appendChild(tokenCount);
		container.appendChild(tokenCountNote);

		const textAreaComponent = new TextAreaComponent(contentEl);
		textAreaComponent
			.setValue(this.settings.systemPrompt)
			.onChange(async (value) => {
				this.settings.systemPrompt = value;

				formatDisplay.innerText = await displayFormatter.format(value);
				updateTokenCount();
			});

		new FormatSyntaxSuggester(
			this.app,
			textAreaComponent.inputEl,
			getQuickAddInstance()
		);
		const displayFormatter = new FormatDisplayFormatter(
			this.app,
			getQuickAddInstance()
		);

		textAreaComponent.inputEl.addClass("qa-ai-prompt-textarea");

		const formatDisplay = this.contentEl.createEl("span");
		const updateTokenCount = debounce(() => {
			tokenCount.innerText = `Estimated tokens: ${this.systemPromptTokenLength}`;
		}, 50);

		updateTokenCount();

		void (async () =>
			(formatDisplay.innerText = await displayFormatter.format(
				this.settings.systemPrompt ?? ""
			)))();
	}

	addShowAdvancedSettingsToggle(container: HTMLElement) {
		new Setting(container)
			.setName("Show advanced settings")
			.setDesc(
				"Sampling settings such as temperature and top p. Untouched settings use the provider's defaults."
			)
			.addToggle((toggle) => {
				toggle.setValue(this.showAdvancedSettings);
				toggle.onChange((value) => {
					this.showAdvancedSettings = value;
					this.reload();
				});
			});
	}

	onClose(): void {
		// Dismissing via Esc / click-outside / X discards edits (matches the
		// Conditional/Open File modals). Only the Save button commits the working copy.
		if (!this.isResolved) {
			this.restoreOriginal();
			this.resolve(null);
		}
		super.onClose();
	}
}
