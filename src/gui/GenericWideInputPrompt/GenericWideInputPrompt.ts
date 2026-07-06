import type { App } from "obsidian";
import { ButtonComponent, Modal, TextAreaComponent } from "obsidian";
import { FileSuggester } from "../suggesters/fileSuggester";
import { TagSuggester } from "../suggesters/tagSuggester";
import { InputPromptDraftHandler } from "../../utils/InputPromptDraftHandler";
import type { InputPromptOptions } from "../../types/inputPrompt";
import { positionInputPromptCursor } from "../inputPromptCursor";
import { attachTextareaIndent } from "../components/textareaIndent";
import { isSkipPromptShortcut } from "../GenericInputPrompt/GenericInputPrompt";
import type { ImagePasteHandle } from "../imagePasteHandler";
import { attachImagePasteHandler } from "../imagePasteHandler";

export default class GenericWideInputPrompt extends Modal {
	public waitForClose: Promise<string>;

	private resolvePromise: (input: string) => void;
	private rejectPromise: (reason?: unknown) => void;
	private didSubmit = false;
	private didClose = false;
	private inputComponent: TextAreaComponent;
	private input: string;
	private readonly placeholder: string;
	private readonly draftHandler: InputPromptDraftHandler;
	private readonly description?: string;
	private fileSuggester: FileSuggester;
	private tagSuggester: TagSuggester;
	private disposeIndent?: () => void;
	private imagePasteHandle?: ImagePasteHandle;

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

	protected constructor(
		app: App,
		private header: string,
		placeholder?: string,
		value?: string,
		private linkSourcePath?: string,
		description?: string,
		private readonly options?: InputPromptOptions,
	) {
		super(app);
		this.placeholder = placeholder ?? "";
		this.description = description?.trim() || undefined;
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

		if (this.description) {
			const descriptionEl = this.contentEl.createDiv({
				text: this.description,
				cls: "setting-item-description",
			});
			descriptionEl.setCssStyles({ marginBottom: "0.75rem" });
		}

		if (this.isOptionalPrompt) {
			const hintEl = this.contentEl.createDiv({
				text: "Optional — leave empty, press Skip, or ctrl/cmd+shift+↵.",
				cls: "setting-item-description",
			});
			hintEl.setCssStyles({ marginBottom: "0.75rem" });
		}

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

		// Tab inserts a tab / indents instead of moving focus (issue #764).
		this.disposeIndent = attachTextareaIndent(textComponent.inputEl);

		if (this.options?.imagePaste) {
			this.imagePasteHandle = attachImagePasteHandler(
				this.app,
				textComponent.inputEl,
				this.options.imagePaste,
			);
		}

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

	private get isOptionalPrompt(): boolean {
		return this.options?.optional === true;
	}

	private createButtonBar(mainContentContainer: HTMLDivElement) {
		const buttonBarContainer: HTMLDivElement =
			mainContentContainer.createDiv();
		this.createButton(
			buttonBarContainer,
			"Ok",
			this.submitClickCallback,
		).setCta().buttonEl.setCssStyles({ marginRight: "0" });
		this.createButton(
			buttonBarContainer,
			"Cancel",
			this.cancelClickCallback,
		);
		if (this.isOptionalPrompt) {
			// Created last so the row-reverse layout renders it leftmost.
			const skipButton = this.createButton(
				buttonBarContainer,
				"Skip",
				this.skipClickCallback,
			);
			skipButton.setTooltip("Leave this field empty");
			skipButton.buttonEl.setAttribute(
				"aria-label",
				"Skip and leave empty",
			);
		}

		buttonBarContainer.setCssStyles({
			display: "flex",
			flexDirection: "row-reverse",
			justifyContent: "flex-start",
			marginTop: "1rem",
			gap: "0.5rem",
		});
	}

	private submitClickCallback = (evt: MouseEvent) => this.submit();
	private cancelClickCallback = (evt: MouseEvent) => this.cancel();
	private skipClickCallback = (evt: MouseEvent) => this.skip();

	private submitEnterCallback = (evt: KeyboardEvent) => {
		// Skip is checked first: ctrl/cmd+shift+Enter leaves the field empty on
		// optional prompts. Without this guard it would fall through to the
		// ctrl/cmd+Enter submit below, the collision noted in issue #1259.
		if (this.isOptionalPrompt && isSkipPromptShortcut(evt)) {
			evt.preventDefault();
			this.skip();
			return;
		}
		if ((evt.ctrlKey || evt.metaKey) && evt.key === "Enter") {
			evt.preventDefault();
			this.submit();
		}
	};

	private submit() {
		// didClose guards the deferred path below: cancel/Esc while a paste
		// save is in flight must not let the queued submit fire on the closed
		// modal (re-resolving the rejected promise, double onClose).
		if (this.didSubmit || this.didClose) return;
		// A pasted image may still be saving; defer so ctrl/cmd+Enter right
		// after Ctrl+V submits WITH the embed link instead of racing the save.
		if (this.imagePasteHandle?.isBusy()) {
			void this.imagePasteHandle.whenIdle().then(() => this.submit());
			return;
		}
		// Resolve the textarea value verbatim — identical to the single-line
		// GenericInputPrompt (whose transformInputOnSubmit is the identity). The
		// substituted {{VALUE}} is never linebreak-processed (the formatter's
		// expandLinebreakEscapesOutsideTokens runs on the template before
		// substitution and skips token spans), and the only un-doubler
		// replaceLinebreakInString has no production callers, so any transform here
		// would corrupt the value with no downstream reversal (issue: a typed
		// "C:\temp" must reach the note and quickAddApi.wideInputPrompt() as
		// "C:\temp", not "C:\\temp").
		this.input = this.inputComponent?.inputEl?.value ?? this.input;
		this.didSubmit = true;

		this.close();
	}

	/** Skip resolves "" (an intentional empty answer); Esc/Cancel still reject. */
	private skip() {
		if (this.didSubmit) return;
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
		this.disposeIndent?.();
		this.imagePasteHandle?.detach();
	}

	onOpen() {
		void super.onOpen();

		positionInputPromptCursor(this.inputComponent.inputEl, this.options);
	}

	onClose() {
		this.didClose = true;
		if (!this.didSubmit) {
			this.syncInputFromEl();
		}
		this.persistDraft();
		this.resolveInput();
		this.removeInputListener();
		// Tear down the suggesters deterministically. close() intentionally keeps
		// each suggester's input/focus/blur listeners and its instanceMap entry
		// alive so typing can reopen the dropdown; destroy() removes those and,
		// via close(), the popper plus the global document/window listeners - so
		// nothing lingers past the modal (and nothing leaks if the dropdown was
		// still open at teardown). Optional-chained for the constructor-throw path.
		this.fileSuggester?.destroy();
		this.tagSuggester?.destroy();
		super.onClose();
	}
}
