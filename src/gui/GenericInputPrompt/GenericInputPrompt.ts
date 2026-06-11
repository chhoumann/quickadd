import type { App } from "obsidian";
import { ButtonComponent, Modal, TextComponent } from "obsidian";
import { FileSuggester } from "../suggesters/fileSuggester";
import { TagSuggester } from "../suggesters/tagSuggester";
import { InputPromptDraftHandler } from "../../utils/InputPromptDraftHandler";
import type { InputPromptOptions } from "../../types/inputPrompt";
import { positionInputPromptCursor } from "../inputPromptCursor";

export default class GenericInputPrompt extends Modal {
	public waitForClose: Promise<string>;

	private resolvePromise: (input: string) => void;
	private rejectPromise: (reason?: unknown) => void;
	private didSubmit = false;
	protected inputComponent: TextComponent;
	protected input: string;
	private readonly placeholder: string;
	private readonly draftHandler: InputPromptDraftHandler;
	private readonly description?: string;
	private fileSuggester: FileSuggester;
	private tagSuggester: TagSuggester;

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

	protected constructor(
		app: App,
		private header: string,
		placeholder?: string,
		value?: string,
		private linkSourcePath?: string,
		description?: string,
		protected readonly options?: InputPromptOptions,
	) {
		super(app);
		this.placeholder = placeholder ?? "";
		this.description = description?.trim() || undefined;
		this.draftHandler = new InputPromptDraftHandler({
			kind: "single",
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
		this.tagSuggester = new TagSuggester(
			app,
			this.inputComponent.inputEl
		);
	}

	private display() {
		this.containerEl.addClass("quickAddModal", "qaInputPrompt");
		this.contentEl.empty();
		this.titleEl.textContent = this.header;

		if (this.description) {
			const descriptionEl = this.contentEl.createDiv({
				text: this.description,
				cls: "setting-item-description",
			});
			descriptionEl.style.marginBottom = "0.75rem";
		}

		if (this.isOptionalPrompt) {
			const hintEl = this.contentEl.createDiv({
				text: "Optional — leave empty or press Skip.",
				cls: "setting-item-description",
			});
			hintEl.style.marginBottom = "0.75rem";
		}

		const mainContentContainer: HTMLDivElement = this.contentEl.createDiv();
		this.inputComponent = this.createInputField(
			mainContentContainer,
			this.placeholder,
			this.input
		);
		this.createButtonBar(mainContentContainer);
	}

	protected get isOptionalPrompt(): boolean {
		return this.options?.optional === true;
	}

	protected createInputField(
		container: HTMLElement,
		placeholder?: string,
		value?: string
	) {
		const textComponent = new TextComponent(container);

		textComponent.inputEl.style.width = "100%";
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
		callback: (evt: MouseEvent) => unknown
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
			this.submitClickCallback
		).setCta().buttonEl.style.marginRight = "0";
		this.createButton(
			buttonBarContainer,
			"Cancel",
			this.cancelClickCallback
		);
		if (this.isOptionalPrompt) {
			// Created last so the row-reverse layout renders it leftmost.
			const skipButton = this.createButton(
				buttonBarContainer,
				"Skip",
				this.skipClickCallback
			);
			skipButton.setTooltip("Leave this field empty");
			skipButton.buttonEl.setAttribute(
				"aria-label",
				"Skip and leave empty"
			);
		}

		buttonBarContainer.style.display = "flex";
		buttonBarContainer.style.flexDirection = "row-reverse";
		buttonBarContainer.style.justifyContent = "flex-start";
		buttonBarContainer.style.marginTop = "1rem";
		buttonBarContainer.style.gap = "0.5rem";
	}

	private submitClickCallback = (evt: MouseEvent) => this.submit();
	private cancelClickCallback = (evt: MouseEvent) => this.cancel();
	private skipClickCallback = (evt: MouseEvent) => this.skip();

	protected submitEnterCallback = (evt: KeyboardEvent) => {
		if (!evt.isComposing && evt.key === "Enter") {
			evt.preventDefault();
			this.submit();
		}
	};

	protected transformInputOnSubmit(input: string): string {
		return input;
	}

	private submit() {
		const rawInput = this.inputComponent?.inputEl?.value ?? this.input;
		this.input = this.transformInputOnSubmit(rawInput);
		this.didSubmit = true;

		this.close();
	}

	/**
	 * Skip is a resolution, never a rejection: the prompt resolves "" so the
	 * formatter stores an intentional empty answer. Esc/Cancel still reject.
	 * Only reachable on optional prompts (the Skip button is the sole caller).
	 */
	protected skip() {
		this.input = "";
		this.didSubmit = true;

		this.close();
	}

	private cancel() {
		this.close();
	}

	private resolveInput() {
		if (!this.didSubmit) this.rejectPromise("No input given.");
		else this.resolvePromise(this.input);
	}

	protected onInputChanged(value: string) {
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
			this.submitEnterCallback
		);
	}

	onOpen() {
		super.onOpen();

		positionInputPromptCursor(this.inputComponent.inputEl, this.options);
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
