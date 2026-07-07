import type { App } from "obsidian";
import { Modal, Setting, TextAreaComponent, debounce } from "obsidian";
import { FormatSyntaxSuggester } from "./../suggesters/formatSyntaxSuggester";
import { getQuickAddInstance } from "src/quickAddInstance";
import { FormatDisplayFormatter } from "src/formatters/formatDisplayFormatter";
import type { IInfiniteAIAssistantCommand } from "src/types/macros/QuickCommands/IAIAssistantCommand";
import GenericInputPrompt from "../GenericInputPrompt/GenericInputPrompt";
import { estimateTokenCount } from "src/ai/tokenEstimator";
import { getMaxChunkTokensUpperBound } from "src/ai/aiHelpers";
import { populateModelDropdown } from "../modelSelect";
import { activeModelRef } from "src/ai/Provider";
import { addSamplingParamSettings } from "./samplingParamSettings";

export class InfiniteAIAssistantCommandSettingsModal extends Modal {
	public waitForClose: Promise<IInfiniteAIAssistantCommand>;

	private resolvePromise: (settings: IInfiniteAIAssistantCommand) => void;
	private rejectPromise: (reason?: unknown) => void;

	private settings: IInfiniteAIAssistantCommand;
	private showAdvancedSettings = false;

	private get systemPromptTokenLength(): number {
		// The estimate is provider-agnostic, so it no longer depends on the model.
		return estimateTokenCount(this.settings.systemPrompt);
	}

	constructor(app: App, settings: IInfiniteAIAssistantCommand) {
		super(app);

		this.settings = settings;

		this.waitForClose = new Promise<IInfiniteAIAssistantCommand>(
			(resolve, reject) => {
				this.rejectPromise = reject;
				this.resolvePromise = resolve;
			}
		);

		this.open();
		this.display();
	}

	private display(): void {
		this.contentEl.empty();
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

		this.addResultJoinerSetting(this.contentEl);
		this.addChunkSeparatorSetting(this.contentEl);
		this.addMaxTokensSetting(this.contentEl);
		this.addMergeChunksSetting(this.contentEl);

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
	}

	private reload(): void {
		this.contentEl.empty();

		this.display();
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

	addResultJoinerSetting(container: HTMLElement) {
		new Setting(container)
			.setName("Result Joiner")
			.setDesc(
				"The string used to join multiple LLM responses together. The default is a newline."
			)
			.addText((text) => {
				text.setValue(this.settings.resultJoiner).onChange((value) => {
					this.settings.resultJoiner = value;
				});
			});
	}

	addChunkSeparatorSetting(container: HTMLElement) {
		new Setting(container)
			.setName("Chunk Separator")
			.setDesc(
				"The string used to separate chunks of text. The default is a newline."
			)
			.addText((text) => {
				text.setValue(this.settings.chunkSeparator).onChange(
					(value) => {
						this.settings.chunkSeparator = value;
					}
				);
			});
	}

	addMaxTokensSetting(container: HTMLElement) {
		new Setting(container)
			.setName("Max Chunk Tokens")
			.setDesc(
				"Maximum estimated tokens for each chunk of your text (the {{chunk}} portion only — the system prompt and prompt template are accounted for separately). Counts are estimated locally; the provider enforces the exact limit. Leave room for the model's response. Values above the model's estimated input budget are capped automatically."
			)
			.addSlider((slider) => {
				// The selected model may be unknown at config time — the "Ask me"
				// sentinel (resolved at runtime) or a model that was removed. Use
				// a fallback bound instead of throwing, which would blank the modal.
				const sliderMax = getMaxChunkTokensUpperBound(
					activeModelRef(this.settings.model, this.settings.modelRef) ??
						this.settings.model,
					this.systemPromptTokenLength,
				);
				slider.setLimits(1, sliderMax, 1);

				slider.setValue(this.settings.maxChunkTokens);
				slider.onChange((value) => {
					this.settings.maxChunkTokens = value;
				});
			});
	}

	addMergeChunksSetting(container: HTMLElement) {
		new Setting(container)
			.setName("Merge Chunks")
			.setDesc(
				"Merge chunks together by putting them in the same prompt, until the max tokens limit is reached. Useful for sending fewer queries overall, but may result in less coherent responses."
			)
			.addToggle((toggle) => {
				toggle.setValue(this.settings.mergeChunks);
				toggle.onChange((value) => {
					this.settings.mergeChunks = value;
				});
			});
	}

	onClose(): void {
		this.resolvePromise(this.settings);
		super.onClose();
	}
}
