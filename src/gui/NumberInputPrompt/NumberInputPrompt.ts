import type { App } from "obsidian";
import type { TextComponent } from "obsidian";
import GenericInputPrompt from "../GenericInputPrompt/GenericInputPrompt";
import type { InputPromptOptions } from "../../types/inputPrompt";
import { normalizeNumericValue } from "../../utils/valueSyntax";

/**
 * A {@link GenericInputPrompt} that renders an `<input type="number">` for
 * `{{VALUE:x|type:number}}` tokens. Chromium-based number inputs reject
 * non-numeric content (the element's `.value` returns "" for invalid input),
 * so a typed scalar always ends up either a valid number or empty — never the
 * raw garbage that would land in frontmatter as a string and trip Obsidian's
 * "Type mismatch". The returned value is still a string ("42") and is written
 * raw-inline, which Obsidian already infers as a Number.
 *
 * Mirrors {@link GenericWideInputPrompt}: each prompt class owns a static
 * `Prompt`/`PromptWithContext` that constructs ITS OWN type, because the base
 * `GenericInputPrompt.Prompt` hardcodes `new GenericInputPrompt`.
 */
export default class NumberInputPrompt extends GenericInputPrompt {
	public static Prompt(
		app: App,
		header: string,
		placeholder?: string,
		value?: string,
		description?: string,
		options?: InputPromptOptions,
	): Promise<string> {
		const modal = new NumberInputPrompt(
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
		const modal = new NumberInputPrompt(
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
		placeholder?: string,
		value?: string,
	): TextComponent {
		const textComponent = super.createInputField(
			container,
			placeholder,
			value,
		);
		textComponent.inputEl.type = "number";
		textComponent.inputEl.inputMode = "decimal";
		const numeric = this.options?.numeric;
		if (numeric?.min !== undefined) {
			textComponent.inputEl.min = String(numeric.min);
		}
		if (numeric?.max !== undefined) {
			textComponent.inputEl.max = String(numeric.max);
		}
		textComponent.inputEl.setAttr(
			"step",
			numeric?.step !== undefined ? String(numeric.step) : "any",
		);
		return textComponent;
	}

	protected transformInputOnSubmit(input: string): string {
		if (!this.options?.numeric) return input;
		if (input === "" && this.isOptionalPrompt) return "";
		return normalizeNumericValue(input, this.options.numeric);
	}
}
