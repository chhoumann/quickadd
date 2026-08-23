import type { App, Scope } from "obsidian";
import { getActiveMarkdownEditorView } from "../../utils/activeMarkdownEditor";
import { PromptPeekSession } from "./PromptPeekSession";
import { replaceRange } from "./peekText";
import { markPromptHidden, markPromptVisible } from "./visiblePrompts";

export const PEEK_HIDDEN_CLASS = "qa-prompt-peek-hidden";

export type InputPromptPeekHost = {
	app: App;
	title: string;
	/** The host modal's chrome; peek hides it instead of closing it. */
	containerEl: HTMLElement;
	/** The host modal's keyboard scope, popped while the prompt is hidden. */
	scope: Scope;
	getField(): HTMLInputElement | HTMLTextAreaElement | undefined;
	getValue(): string;
	setValue(value: string): void;
	markDraftChanged(): void;
	persistDraft(): void;
	/** Really close the modal; the host's onClose settles the run. */
	close(): void;
};

/**
 * Owns the peek state for one input prompt. Peeking hides the modal rather
 * than closing it, so the field, suggesters, paste handler, undo history,
 * and selection all stay live while the user reads the note. The modal is
 * only ever truly closed to settle the run, which keeps the invariant that
 * every onClose resolves or rejects `waitForClose`.
 */
export class InputPromptPeek {
	private peeking = false;
	private session: PromptPeekSession | null = null;

	constructor(private readonly host: InputPromptPeekHost) {}

	peek(): void {
		if (this.peeking) return;
		const field = this.host.getField();
		if (field) this.host.setValue(field.value);
		this.host.persistDraft();
		this.peeking = true;
		this.hideModal();
		this.session = PromptPeekSession.activate(this.host.app, {
			title: this.host.title,
			resume: () => this.resume(),
			cancel: () => this.cancel(),
			insertSelectionAndResume: (selection) =>
				this.insertSelectionAndResume(selection),
		});
	}

	/** Host onOpen: the modal is on screen. */
	onHostOpened(): void {
		markPromptVisible(this.host);
	}

	/** Host onClose: the modal is really closing, whatever the path. */
	onHostClosed(): void {
		markPromptHidden(this.host);
		if (!this.peeking) return;
		// Closed from outside while hidden (plugin unload, displacement):
		// drop the chip so it cannot resume a settled run.
		this.peeking = false;
		this.session?.discard();
		this.session = null;
	}

	private hideModal(): void {
		markPromptHidden(this.host);
		this.host.containerEl.addClass(PEEK_HIDDEN_CLASS);
		// Pop the modal scope: it would keep global hotkeys dead, and its
		// Escape binding would close a modal the user cannot see.
		this.host.app.keymap.popScope(this.host.scope);
		focusActiveEditor(this.host.app);
	}

	private showModal(): void {
		this.host.app.keymap.pushScope(this.host.scope);
		this.host.containerEl.removeClass(PEEK_HIDDEN_CLASS);
		markPromptVisible(this.host);
		// The field kept its selection while hidden; focus restores it.
		this.host.getField()?.focus();
	}

	private resume(): void {
		if (!this.peeking) return;
		this.peeking = false;
		this.session = null;
		this.showModal();
	}

	private insertSelectionAndResume(selection: string): void {
		if (!this.peeking) return;
		const field = this.host.getField();
		if (field) {
			// Replace the field's own (preserved) selection, so a select-all
			// draft is replaced and a caret gets a plain insertion.
			const start = field.selectionStart ?? field.value.length;
			const end = field.selectionEnd ?? start;
			const next = replaceRange(field.value, start, end, selection);
			field.value = next.text;
			field.setSelectionRange(next.cursor, next.cursor);
			this.host.setValue(next.text);
		} else {
			this.host.setValue(this.host.getValue() + selection);
		}
		this.host.markDraftChanged();
		this.host.persistDraft();
		this.resume();
	}

	private cancel(): void {
		if (!this.peeking) return;
		this.peeking = false;
		this.session = null;
		// Re-push the modal scope so close() pops the scope it expects.
		this.host.app.keymap.pushScope(this.host.scope);
		this.host.close();
	}
}

function focusActiveEditor(app: App): void {
	const editor = getActiveMarkdownEditorView(app)?.editor as
		| { focus?: () => void }
		| undefined;
	editor?.focus?.();
}
