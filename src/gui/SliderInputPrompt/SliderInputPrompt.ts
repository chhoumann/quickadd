import type { App, TextComponent } from "obsidian";
import GenericInputPrompt from "../GenericInputPrompt/GenericInputPrompt";
import type { InputPromptOptions } from "../../types/inputPrompt";
import {
	normalizeNumericValue,
	normalizeSliderValue,
} from "../../utils/valueSyntax";

const FALLBACK_SLIDER = { min: 0, max: 100, step: 1 };

export default class SliderInputPrompt extends GenericInputPrompt {
	private sliderEl?: HTMLInputElement;
	private numberEl?: HTMLInputElement;

	public static Prompt(
		app: App,
		header: string,
		placeholder?: string,
		value?: string,
		description?: string,
		options?: InputPromptOptions,
	): Promise<string> {
		const modal = new SliderInputPrompt(
			app,
			header,
			placeholder,
			value,
			undefined,
			description,
			options,
		);
		return modal.waitForClose;
	}

	public static PromptWithContext(
		app: App,
		header: string,
		placeholder?: string,
		value?: string,
		linkSourcePath?: string,
		description?: string,
		options?: InputPromptOptions,
	): Promise<string> {
		const modal = new SliderInputPrompt(
			app,
			header,
			placeholder,
			value,
			linkSourcePath,
			description,
			options,
		);
		return modal.waitForClose;
	}

	protected createInputField(
		container: HTMLElement,
		_placeholder?: string,
		value?: string,
	): TextComponent {
		const config = this.options?.slider ?? FALLBACK_SLIDER;
		const isOptionalBlank = this.isOptionalPrompt && !value;
		const initial = normalizeSliderValue(value, config);

		this.sliderEl = container.createEl("input");
		this.sliderEl.type = "range";
		this.sliderEl.min = String(config.min);
		this.sliderEl.max = String(config.max);
		this.sliderEl.step = String(config.step);
		this.sliderEl.value = initial;
		this.sliderEl.setCssStyles({ width: "100%" });

		const textComponent = super.createInputField(container, undefined, initial);
		this.numberEl = textComponent.inputEl;
		this.numberEl.type = "number";
		this.numberEl.inputMode = "decimal";
		this.numberEl.min = String(config.min);
		this.numberEl.max = String(config.max);
		this.numberEl.step = String(config.step);
		if (isOptionalBlank) {
			this.numberEl.value = "";
		}

		this.sliderEl.addEventListener("input", () => this.syncFromSlider());
		this.numberEl.addEventListener("input", () => this.syncFromNumber());

		return textComponent;
	}

	private syncFromSlider(): void {
		if (!this.sliderEl || !this.numberEl) return;
		this.numberEl.value = this.sliderEl.value;
		this.onInputChanged(this.sliderEl.value);
	}

	private syncFromNumber(): void {
		if (!this.sliderEl || !this.numberEl) return;
		const value = this.numberEl.value;
		if (value === "" && this.isOptionalPrompt) {
			this.onInputChanged("");
			return;
		}
		const normalized = normalizeNumericValue(
			value,
			this.options?.slider ?? FALLBACK_SLIDER,
		);
		if (normalized !== "") {
			this.sliderEl.value = normalized;
		}
		this.onInputChanged(value);
	}

	protected transformInputOnSubmit(input: string): string {
		if (input === "" && this.isOptionalPrompt) return "";
		return normalizeSliderValue(input, this.options?.slider ?? FALLBACK_SLIDER);
	}
}
