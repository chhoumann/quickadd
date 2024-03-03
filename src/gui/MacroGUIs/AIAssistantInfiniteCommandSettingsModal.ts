import { Modal, Setting, TextAreaComponent, debounce } from "obsidian";
import { FormatSyntaxSuggester } from "./../suggesters/formatSyntaxSuggester";
import QuickAdd from "src/main";
import { FormatDisplayFormatter } from "src/formatters/formatDisplayFormatter";
import type { IInfiniteAIAssistantCommand } from "src/types/macros/QuickCommands/IAIAssistantCommand";
import GenericInputPrompt from "../GenericInputPrompt/GenericInputPrompt";
import {
	DEFAULT_FREQUENCY_PENALTY,
	DEFAULT_PRESENCE_PENALTY,
	DEFAULT_TEMPERATURE,
	DEFAULT_TOP_P,
} from "src/ai/OpenAIModelParameters";
import { getTokenCount } from "src/ai/AIAssistant";
import { getModelByName, getModelNames } from "src/ai/aiHelpers";

export class InfiniteAIAssistantCommandSettingsModal extends Modal {
	public waitForClose: Promise<IInfiniteAIAssistantCommand>;

	private resolvePromise: (settings: IInfiniteAIAssistantCommand) => void;
	private rejectPromise: (reason?: unknown) => void;

	private settings: IInfiniteAIAssistantCommand;
	private showAdvancedSettings = false;

	private get systemPromptTokenLength(): number {
		const model = getModelByName(this.settings.model);
		if (!model) return Number.POSITIVE_INFINITY;
		return getTokenCount(this.settings.systemPrompt, model);
	}

	constructor(settings: IInfiniteAIAssistantCommand) {
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
			this.addTemperatureSetting(this.contentEl);
			this.addTopPSetting(this.contentEl);
			this.addFrequencyPenaltySetting(this.contentEl);
			this.addPresencePenaltySetting(this.contentEl);
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
				const models = getModelNames();
				for (const model of models) {
					dropdown.addOption(model, model);
				}

				dropdown.addOption("Ask me", "Ask me");

				dropdown.setValue(this.settings.model);
				dropdown.onChange((value) => {
					this.settings.model = value;
					
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
		const tokenCount = container.createEl("span");
		tokenCount.style.color = "var(--text-muted-color)";

		container.appendChild(tokenCount);

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
		const updateTokenCount = debounce(() => {
			tokenCount.innerText = `Token count: ${this.systemPromptTokenLength}`;
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
				"Show advanced settings such as temperature, top p, and frequency penalty."
			)
			.addToggle((toggle) => {
				toggle.setValue(this.showAdvancedSettings);
				toggle.onChange((value) => {
					this.showAdvancedSettings = value;
					this.reload();
				});
			});
	}

	addTemperatureSetting(container: HTMLElement) {
		new Setting(container)
			.setName("Temperature")
			.setDesc(
				"Sampling temperature. Higher values like 0.8 makes the output more random, whereas lower values like 0.2 will make it more focused and deterministic. The default is 1."
			)
			.addSlider((slider) => {
				slider.setLimits(0, 1, 0.1);
				slider.setDynamicTooltip();
				slider.setValue(
					this.settings.modelParameters.temperature ??
						DEFAULT_TEMPERATURE
				);
				slider.onChange((value) => {
					this.settings.modelParameters.temperature = value;
				});
			});
	}

	addTopPSetting(container: HTMLElement) {
		new Setting(container)
			.setName("Top P")
			.setDesc(
				"Nucleus sampling - consider this an alternative to temperature. The model considers the results of the tokens with top_p probability mass. 0.1 means only tokens compromising the top 10% probability mass are considered. The default is 1."
			)
			.addSlider((slider) => {
				slider.setLimits(0, 1, 0.1);
				slider.setDynamicTooltip();
				slider.setValue(
					this.settings.modelParameters.top_p ?? DEFAULT_TOP_P
				);
				slider.onChange((value) => {
					this.settings.modelParameters.top_p = value;
				});
			});
	}

	addFrequencyPenaltySetting(container: HTMLElement) {
		new Setting(container)
			.setName("Frequency Penalty")
			.setDesc(
				"Positive values penalize new tokens based on their existing frequency in the text so far, decreasing the model's likelihood to repeat the same line verbatim. The default is 0."
			)
			.addSlider((slider) => {
				slider.setLimits(0, 2, 0.1);
				slider.setDynamicTooltip();
				slider.setValue(
					this.settings.modelParameters.frequency_penalty ??
						DEFAULT_FREQUENCY_PENALTY
				);
				slider.onChange((value) => {
					this.settings.modelParameters.frequency_penalty = value;
				});
			});
	}

	addPresencePenaltySetting(container: HTMLElement) {
		new Setting(container)
			.setName("Presence Penalty")
			.setDesc(
				"Positive values penalize new tokens based on whether they appear in the text so far, increasing the model's likelihood to talk about new topics. The default is 0."
			)
			.addSlider((slider) => {
				slider.setLimits(0, 2, 0.1);
				slider.setDynamicTooltip();
				slider.setValue(
					this.settings.modelParameters.presence_penalty ??
						DEFAULT_PRESENCE_PENALTY
				);
				slider.onChange((value) => {
					this.settings.modelParameters.presence_penalty = value;
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
				"The maximum number of tokens in each chunk, calculated as the chunk token size + prompt template token size + system prompt token size. Make sure you leave room for the model to respond to the prompt."
			)
			.addSlider((slider) => {
				const model = getModelByName(this.settings.model);

				if (!model) {
					throw new Error(
						`Model ${this.settings.model} not found in settings`
					);
				}

				slider.setLimits(1, model.maxTokens - this.systemPromptTokenLength, 1);
				slider.setDynamicTooltip();

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
