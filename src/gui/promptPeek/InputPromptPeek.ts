import type { App } from "obsidian";
import { PromptPeekSession } from "./PromptPeekSession";
import {
	beginPeek,
	canPeek,
	insertAtCursor,
	resumePeek,
	settlePeek,
	shouldSettleOnClose,
	type PromptPeekPhase,
} from "./promptPeekPhase";

export type InputPromptPeekHost = {
	app: App;
	title: string;
	getField(): HTMLInputElement | HTMLTextAreaElement | undefined;
	getValue(): string;
	setValue(value: string): void;
	markDraftChanged(): void;
	persistDraft(): void;
	remount(): void;
	close(): void;
	settleCancel(): void;
};

/**
 * Owns the peek phase for one input prompt. The host still owns the Obsidian
 * Modal; this object decides whether close() settles the run.
 */
export class InputPromptPeek {
	private phase: PromptPeekPhase = { kind: "open" };
	private resumeCursor = 0;

	constructor(private readonly host: InputPromptPeekHost) {}

	peek(): void {
		if (!canPeek(this.phase)) return;
		const field = this.host.getField();
		if (field) {
			this.host.setValue(field.value);
			this.resumeCursor = field.selectionStart ?? field.value.length;
		} else {
			this.resumeCursor = this.host.getValue().length;
		}
		this.host.persistDraft();
		this.phase = beginPeek(this.phase);
		PromptPeekSession.activate(this.host.app, {
			title: this.host.title,
			resume: () => this.resume(),
			cancel: () => this.cancel(),
			insertSelectionAndResume: (selection) =>
				this.insertSelectionAndResume(selection),
		});
		this.host.close();
	}

	shouldSettleOnClose(): boolean {
		return shouldSettleOnClose(this.phase);
	}

	private restoreFieldCaret(): void {
		const field = this.host.getField();
		if (!field) return;
		const cursor = Math.max(0, Math.min(this.resumeCursor, field.value.length));
		field.focus();
		field.setSelectionRange(cursor, cursor);
	}

	private resume(): void {
		if (this.phase.kind !== "peeking") return;
		this.phase = resumePeek(this.phase);
		this.host.remount();
		this.restoreFieldCaret();
	}

	private insertSelectionAndResume(selection: string): void {
		if (this.phase.kind !== "peeking") return;
		const next = insertAtCursor(this.host.getValue(), this.resumeCursor, selection);
		this.host.setValue(next.text);
		this.resumeCursor = next.cursor;
		this.host.markDraftChanged();
		this.host.persistDraft();
		this.resume();
	}

	private cancel(): void {
		if (this.phase.kind !== "peeking") return;
		this.phase = settlePeek(this.phase, "cancelled");
		this.host.settleCancel();
	}
}
