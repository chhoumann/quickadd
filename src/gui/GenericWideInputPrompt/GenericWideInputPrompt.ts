import type { App } from "obsidian";
import { TextAreaComponent } from "obsidian";
import type { InputPromptOptions } from "../../types/inputPrompt";
import { TextPromptModal } from "../GenericInputPrompt/TextPromptModal";
import { attachTextareaIndent } from "../components/textareaIndent";

export default class GenericWideInputPrompt extends TextPromptModal<TextAreaComponent> {
	public static Prompt(
		app: App,
		header: string,
		placeholder?: string,
		value?: string,
		description?: string,
		options?: InputPromptOptions,
	): Promise<string> {
		const newPromptModal = new GenericWideInputPrompt(
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
		const newPromptModal = new GenericWideInputPrompt(
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

	protected getPromptKind(): "multi" {
		return "multi";
	}

	private disposeIndent?: () => void;

	protected createInputField(
		container: HTMLElement,
		placeholder?: string,
		value?: string,
	): TextAreaComponent {
		const field = new TextAreaComponent(container);
		field.inputEl.classList.add("wideInputPromptInputEl");
		field.inputEl.setAttribute("dir", "auto");
		this.disposeIndent = attachTextareaIndent(field.inputEl);
		return this.configureInput(field, placeholder, value);
	}

	protected shouldSubmit(evt: KeyboardEvent): boolean {
		return (evt.ctrlKey || evt.metaKey) && evt.key === "Enter";
	}

	protected disposeInput(): void {
		this.disposeIndent?.();
	}
}
