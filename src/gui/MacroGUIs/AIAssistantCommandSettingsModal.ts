import type { App } from "obsidian";
import { Setting, TextAreaComponent, debounce } from "obsidian";
import { mountSystemPromptLiteralNote } from "../ai/systemPromptLiteralNote";
import type { IAIAssistantCommand } from "src/types/macros/QuickCommands/IAIAssistantCommand";
import { GenericTextSuggester } from "../suggesters/genericTextSuggester";
import { getMarkdownFilesInFolder } from "src/utils/vaultQueries";
import { settingsStore } from "src/settingsStore";
import GenericInputPrompt from "../GenericInputPrompt/GenericInputPrompt";
import { estimateTokenCount } from "src/ai/tokenEstimator";
import { addSamplingParamSettings } from "./samplingParamSettings";
import { populateModelDropdown } from "../modelSelect";
import { activeModelRef } from "src/ai/Provider";
import { SettingsDialogModal } from "./SettingsDialogModal";

/**
 * Edits the live command in place (the reference the caller persists). Closing
 * without Save restores it from the snapshot taken when the dialog opened.
 */
export class AIAssistantCommandSettingsModal extends SettingsDialogModal<IAIAssistantCommand> {
	private settings: IAIAssistantCommand;
	private readonly originalSettings: IAIAssistantCommand;
	private showAdvancedSettings = false;
	private promptTemplateSuggester: GenericTextSuggester | null = null;

	private get systemPromptTokenLength(): number {
		// The estimate is provider-agnostic, so it no longer depends on the model.
		return estimateTokenCount(this.settings.systemPrompt);
	}

	constructor(app: App, settings: IAIAssistantCommand) {
		super(app);

		this.settings = settings;
		this.originalSettings = this.cloneSettings(settings);

		this.open();
		this.display();
	}

	protected save(): IAIAssistantCommand {
		return this.settings;
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

	// Restores the nested objects too, so no edit made in this session survives.
	protected discard(): void {
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
			text: `${this.settings.name} settings`,
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

		this.addSaveCancelButtons();
	}

	private reload(): void {
		this.promptTemplateSuggester?.destroy();
		this.contentEl.empty();

		this.display();
	}

	onClose(): void {
		super.onClose();
		this.promptTemplateSuggester?.destroy();
		this.promptTemplateSuggester = null;
	}

	addPromptTemplateSetting(container: HTMLElement) {
		const promptTemplatesFolder =
			settingsStore.getState().ai.promptTemplatesFolderPath;
		const promptTemplateFiles = getMarkdownFilesInFolder(
			this.app,
			promptTemplatesFolder
		).map((f) => f.name);

		new Setting(container)
			.setName("Prompt template")
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

				this.promptTemplateSuggester = new GenericTextSuggester(
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
			.setName("System prompt")
			.setDesc("The system prompt for the AI Assistant");

		const container = this.contentEl.createDiv();
		const tokenCount = container.createSpan({
			cls: "qa-ai-token-count",
		});
		const tokenCountNote = container.createDiv({
			text: "Estimated locally. Providers enforce exact context limits.",
			cls: "qa-ai-token-note",
		});

		container.appendChild(tokenCount);
		container.appendChild(tokenCountNote);

		const textAreaComponent = new TextAreaComponent(contentEl);
		textAreaComponent.inputEl.addClass("qa-ai-prompt-textarea");
		// Appended to contentEl rather than the Setting's controlEl (it needs the
		// full modal width), so nothing associates it with the name above.
		textAreaComponent.inputEl.setAttribute("aria-label", "System prompt");

		// No format preview and no `{{` token autocomplete here: the system prompt
		// is sent to the model verbatim (see mountSystemPromptLiteralNote). The
		// token count above is already computed on the raw string, which is the
		// same admission.
		const updateLiteralNote = mountSystemPromptLiteralNote(
			contentEl,
			textAreaComponent.inputEl,
			this.settings.systemPrompt ?? "",
		);

		const updateTokenCount = debounce(() => {
			tokenCount.innerText = `Estimated tokens: ${this.systemPromptTokenLength}`;
		}, 50);

		textAreaComponent
			.setValue(this.settings.systemPrompt)
			.onChange((value) => {
				this.settings.systemPrompt = value;
				updateLiteralNote(value);
				updateTokenCount();
			});

		updateTokenCount();
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
}
