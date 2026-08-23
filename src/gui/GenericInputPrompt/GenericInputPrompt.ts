import type { App } from "obsidian";
import { ButtonComponent, Modal, TextComponent } from "obsidian";
import { FileSuggester } from "../suggesters/fileSuggester";
import { TagSuggester } from "../suggesters/tagSuggester";
import { InputPromptDraftHandler } from "../../utils/InputPromptDraftHandler";
import type { InputPromptOptions } from "../../types/inputPrompt";
import { positionInputPromptCursor } from "../inputPromptCursor";
import { renderPromptContextLine } from "../promptContextLine";
import type { ImagePasteHandle } from "../imagePasteHandler";
import { attachImagePasteHandler } from "../imagePasteHandler";
import { promptCancelled } from "../../errors/UserCancelError";
import { InputPromptPeek } from "../promptPeek/InputPromptPeek";
import { isPeekPromptShortcut, isSkipPromptShortcut } from "../promptShortcuts";
import {
	applyCompactPromptChrome,
	stylePeekButton,
} from "../promptPeek/stylePeekButton";

export default class GenericInputPrompt extends Modal {
	public waitForClose: Promise<string>;

	private resolvePromise: (input: string) => void;
	private rejectPromise: (reason?: unknown) => void;
	private didSubmit = false;
	private didClose = false;
	protected inputComponent: TextComponent;
	protected input: string;
	private readonly placeholder: string;
	private readonly draftHandler: InputPromptDraftHandler;
	private readonly description?: string;
	private fileSuggester: FileSuggester;
	private tagSuggester: TagSuggester;
	private imagePasteHandle?: ImagePasteHandle;
	private readonly peek: InputPromptPeek;

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
			scopeId: options?.draftScopeId,
		});
		this.input = this.draftHandler.hydrate(value ?? "");

		this.waitForClose = new Promise<string>((resolve, reject) => {
			this.resolvePromise = resolve;
			this.rejectPromise = reject;
		});

		this.peek = new InputPromptPeek({
			app,
			title: this.header,
			containerEl: this.containerEl,
			scope: this.scope,
			getField: () => this.inputComponent?.inputEl,
			getValue: () => this.input,
			setValue: (value) => {
				this.input = value;
			},
			markDraftChanged: () => this.draftHandler.markChanged(),
			persistDraft: () => this.persistDraft(),
			close: () => this.close(),
		});

		this.display();
		this.open();
		this.attachSuggesters();
	}

	private display() {
		this.containerEl.addClass("quickAddModal", "qaInputPrompt");
		applyCompactPromptChrome(this.containerEl);
		this.contentEl.empty();
		this.titleEl.textContent = this.header;

		renderPromptContextLine(
			this.contentEl,
			this.options?.contextLine,
			this.options?.contextLineFull,
		);

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
			this.input
		);
		this.createButtonBar(mainContentContainer);
	}

	protected get isOptionalPrompt(): boolean {
		return this.options?.optional === true;
	}

	/**
	 * Peek is opt-in: only prompts opened over the editor during a run set
	 * `allowPeek`. Settings and builder prompts sit on top of another modal,
	 * where hiding the prompt would "peek" at the settings UI.
	 */
	protected supportsPeek(): boolean {
		return this.options?.allowPeek === true;
	}

	protected createInputField(
		container: HTMLElement,
		placeholder?: string,
		value?: string
	) {
		const textComponent = new TextComponent(container);

		textComponent.inputEl.setCssStyles({ width: "100%" });
		textComponent
			.setPlaceholder(placeholder ?? "")
			.setValue(value ?? "")
			.onChange((value) => this.onInputChanged(value))
			.inputEl.addEventListener("keydown", this.submitEnterCallback);

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
		callback: (evt: MouseEvent) => unknown
	) {
		const btn = new ButtonComponent(container);
		btn.setButtonText(text).onClick(callback);

		return btn;
	}

	private createButtonBar(mainContentContainer: HTMLDivElement) {
		const buttonBarContainer: HTMLDivElement = mainContentContainer.createDiv({
			cls: "qa-prompt-actions",
		});

		// Primary actions come first in the DOM so Tab from the input still
		// reaches Ok before Peek; CSS `order` keeps Peek visually left.
		const primary = buttonBarContainer.createDiv({
			cls: "qa-prompt-actions-primary",
		});
		this.createButton(primary, "Ok", this.submitClickCallback)
			.setCta()
			.buttonEl.setCssStyles({ marginRight: "0" });
		this.createButton(primary, "Cancel", this.cancelClickCallback);
		if (this.isOptionalPrompt) {
			const skipButton = this.createButton(
				primary,
				"Skip",
				this.skipClickCallback,
			);
			skipButton.setTooltip("Leave this field empty");
			skipButton.buttonEl.setAttribute(
				"aria-label",
				"Skip and leave empty",
			);
		}

		if (this.supportsPeek()) {
			const secondary = buttonBarContainer.createDiv({
				cls: "qa-prompt-actions-secondary",
			});
			stylePeekButton(
				this.createButton(secondary, "Peek at note", () => this.peek.peek()),
			);
		}
	}

	private submitClickCallback = (evt: MouseEvent) => this.submit();
	private cancelClickCallback = (evt: MouseEvent) => this.cancel();
	private skipClickCallback = (evt: MouseEvent) => this.skip();

	protected submitEnterCallback = (evt: KeyboardEvent) => {
		if (this.supportsPeek() && isPeekPromptShortcut(evt)) {
			evt.preventDefault();
			this.peek.peek();
			return;
		}
		// Skip is checked first so ctrl/cmd+shift+Enter leaves the field empty
		// instead of submitting (only on optional prompts).
		if (this.isOptionalPrompt && isSkipPromptShortcut(evt)) {
			evt.preventDefault();
			this.skip();
			return;
		}
		if (!evt.isComposing && evt.key === "Enter") {
			evt.preventDefault();
			this.submit();
		}
	};

	protected transformInputOnSubmit(input: string): string {
		return input;
	}

	private submit() {
		// didClose guards the deferred path below: cancel/Esc while a paste
		// save is in flight must not let the queued submit fire on the closed
		// modal (re-resolving the rejected promise, double onClose).
		if (this.didSubmit || this.didClose) return;
		// A pasted image may still be saving; defer so Ctrl+V-then-Enter
		// submits WITH the embed link instead of racing the save.
		if (this.imagePasteHandle?.isBusy()) {
			void this.imagePasteHandle.whenIdle().then(() => this.submit());
			return;
		}
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
		if (!this.didSubmit) this.rejectPromise(promptCancelled());
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

	private attachSuggesters() {
		this.fileSuggester = new FileSuggester(this.app, this.inputComponent.inputEl, {
			sourcePath: this.linkSourcePath,
		});
		this.tagSuggester = new TagSuggester(this.app, this.inputComponent.inputEl);
	}

	private removeInputListener() {
		this.inputComponent.inputEl.removeEventListener(
			"keydown",
			this.submitEnterCallback
		);
		this.imagePasteHandle?.detach();
	}

	onOpen() {
		void super.onOpen();

		this.peek.onHostOpened();
		positionInputPromptCursor(this.inputComponent.inputEl, this.options);
	}

	onClose() {
		this.didClose = true;
		if (!this.didSubmit) {
			this.syncInputFromEl();
		}
		this.persistDraft();
		this.peek.onHostClosed();
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
