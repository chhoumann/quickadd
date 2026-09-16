import type { App } from "obsidian";
import { TextComponent } from "obsidian";
import type { InputPromptOptions } from "../../types/inputPrompt";
import { TextPromptModal } from "../GenericInputPrompt/TextPromptModal";

export default class GenericInputPrompt extends TextPromptModal<TextComponent> {
	public static Prompt(
		app: App,
		header: string,
		placeholder?: string,
		value?: string,
		description?: string,
		options?: InputPromptOptions,
	): Promise<string> {
		const newPromptModal = new GenericInputPrompt(
			app,
			header,
			placeholder,
			value,
			undefined,
			description,
			options,
		);
		return newPromptModal.waitForClose;
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
		const newPromptModal = new GenericInputPrompt(
			app,
			header,
			placeholder,
			value,
			linkSourcePath,
			description,
			options,
		);
		return newPromptModal.waitForClose;
	}

	protected getPromptKind(): "single" {
		return "single";
	}

	protected createInputField(
		container: HTMLElement,
		placeholder?: string,
		value?: string,
	): TextComponent {
		const field = new TextComponent(container);
		field.inputEl.setCssStyles({ width: "100%" });
		return this.configureInput(field, placeholder, value);
	}

	protected shouldSubmit(evt: KeyboardEvent): boolean {
		return !evt.isComposing && evt.key === "Enter";
	}
}
