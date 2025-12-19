import type { App } from "obsidian";
import { ButtonComponent, Modal, TextAreaComponent } from "obsidian";
import { FileSuggester } from "../suggesters/fileSuggester";
import { TagSuggester } from "../suggesters/tagSuggester";
import { InputPromptDraftHandler } from "../../utils/InputPromptDraftHandler";

export default class GenericWideInputPrompt extends Modal {
	public waitForClose: Promise<string>;

	private resolvePromise: (input: string) => void;
	private rejectPromise: (reason?: unknown) => void;
	private didSubmit = false;
	private inputComponent: TextAreaComponent;
	private input: string;
	private readonly placeholder: string;
	private readonly draftHandler: InputPromptDraftHandler;
	private fileSuggester: FileSuggester;
	private tagSuggester: TagSuggester;

	public static Prompt(
		app: App,
		header: string,
		placeholder?: string,
		value?: string,
	): Promise<string> {
		const newPromptModal = new GenericWideInputPrompt(
			app,
			header,
			placeholder,
			value,
			undefined
		);
		return newPromptModal.waitForClose;
	}

	public static PromptWithContext(
		app: App,
		header: string,
		placeholder?: string,
		value?: string,
		linkSourcePath?: string
	): Promise<string> {
		const newPromptModal = new GenericWideInputPrompt(
			app,
			header,
			placeholder,
			value,
			linkSourcePath
		);
		return newPromptModal.waitForClose;
	}

	protected constructor(
		app: App,
		private header: string,
		placeholder?: string,
		value?: string,
		private linkSourcePath?: string
	) {
		super(app);
		this.placeholder = placeholder ?? "";
		this.draftHandler = new InputPromptDraftHandler({
			kind: "multi",
			header: this.header,
			placeholder: this.placeholder,
			linkSourcePath: this.linkSourcePath,
		});
		this.input = this.draftHandler.hydrate(value ?? "");

		this.waitForClose = new Promise<string>((resolve, reject) => {
			this.resolvePromise = resolve;
			this.rejectPromise = reject;
		});

		this.display();
		this.open();

		this.fileSuggester = new FileSuggester(
			app,
			this.inputComponent.inputEl,
			{ sourcePath: this.linkSourcePath }
		);
		this.tagSuggester = new TagSuggester(app, this.inputComponent.inputEl);
	}

	private display() {
		this.containerEl.addClass("quickAddModal", "qaWideInputPrompt");
		this.contentEl.empty();
		this.titleEl.textContent = this.header;

		const mainContentContainer: HTMLDivElement = this.contentEl.createDiv();
		this.inputComponent = this.createInputField(
			mainContentContainer,
			this.placeholder,
			this.input,
		);
		this.createButtonBar(mainContentContainer);
	}

	protected createInputField(
		container: HTMLElement,
		placeholder?: string,
		value?: string,
	) {
		const textComponent = new TextAreaComponent(container);

		textComponent.inputEl.classList.add("wideInputPromptInputEl");
		textComponent.inputEl.setAttribute("dir", "auto");
		textComponent
			.setPlaceholder(placeholder ?? "")
			.setValue(value ?? "")
			.onChange((value) => this.onInputChanged(value))
			.inputEl.addEventListener("keydown", this.submitEnterCallback);

		return textComponent;
	}

	private createButton(
		container: HTMLElement,
		text: string,
		callback: (evt: MouseEvent) => unknown,
	) {
		const btn = new ButtonComponent(container);
		btn.setButtonText(text).onClick(callback);

		return btn;
	}

	private createButtonBar(mainContentContainer: HTMLDivElement) {
		const buttonBarContainer: HTMLDivElement =
			mainContentContainer.createDiv();
		this.createButton(
			buttonBarContainer,
			"Ok",
			this.submitClickCallback,
		).setCta().buttonEl.style.marginRight = "0";
		this.createButton(
			buttonBarContainer,
			"Cancel",
			this.cancelClickCallback,
		);

		buttonBarContainer.style.display = "flex";
		buttonBarContainer.style.flexDirection = "row-reverse";
		buttonBarContainer.style.justifyContent = "flex-start";
		buttonBarContainer.style.marginTop = "1rem";
		buttonBarContainer.style.gap = "0.5rem";
	}

	private submitClickCallback = (evt: MouseEvent) => this.submit();
	private cancelClickCallback = (evt: MouseEvent) => this.cancel();

	private submitEnterCallback = (evt: KeyboardEvent) => {
		if ((evt.ctrlKey || evt.metaKey) && evt.key === "Enter") {
			evt.preventDefault();
			this.submit();
		}
	};

	private escapeBackslashes(input: string): string {
		return input.replace(/\\/g, "\\\\");
	}

	private submit() {
		if (this.didSubmit) return;
		this.input = this.inputComponent?.inputEl?.value ?? this.input;
		this.didSubmit = true;
		this.input = this.escapeBackslashes(this.input);

		this.close();
	}

	private cancel() {
		this.close();
	}

	private resolveInput() {
		if (!this.didSubmit) this.rejectPromise("No input given.");
		else this.resolvePromise(this.input);
	}

	private onInputChanged(value: string) {
		this.draftHandler.markChanged();
		this.input = value;
	}

	private syncInputFromEl() {
		if (this.inputComponent?.inputEl) {
			this.input = this.inputComponent.inputEl.value;
		}
	}

	private persistDraft() {
		this.draftHandler.persist(this.input, this.didSubmit);
	}

	private removeInputListener() {
		this.inputComponent.inputEl.removeEventListener(
			"keydown",
			this.submitEnterCallback,
		);
	}

	onOpen() {
		super.onOpen();

		this.inputComponent.inputEl.focus();
		this.inputComponent.inputEl.select();
	}

	onClose() {
		if (!this.didSubmit) {
			this.syncInputFromEl();
		}
		this.persistDraft();
		this.resolveInput();
		this.removeInputListener();
		super.onClose();
	}
}
