export type PromptPeekSettleOutcome = "submitted" | "skipped" | "cancelled";

export type PromptPeekPhase =
	| { readonly kind: "open" }
	| { readonly kind: "peeking" }
	| { readonly kind: "settled"; readonly outcome: PromptPeekSettleOutcome };

export function canPeek(phase: PromptPeekPhase): boolean {
	return phase.kind === "open";
}

export function beginPeek(phase: PromptPeekPhase): PromptPeekPhase {
	if (phase.kind !== "open") return phase;
	return { kind: "peeking" };
}

export function resumePeek(phase: PromptPeekPhase): PromptPeekPhase {
	if (phase.kind !== "peeking") return phase;
	return { kind: "open" };
}

export function settlePeek(
	phase: PromptPeekPhase,
	outcome: PromptPeekSettleOutcome,
): PromptPeekPhase {
	switch (phase.kind) {
		case "open":
		case "peeking":
			return { kind: "settled", outcome };
		case "settled":
			return phase;
		default: {
			const _exhaustive: never = phase;
			return _exhaustive;
		}
	}
}

export function shouldSettleOnClose(phase: PromptPeekPhase): boolean {
	return phase.kind !== "peeking";
}

export function insertAtCursor(
	text: string,
	cursor: number,
	inserted: string,
): { text: string; cursor: number } {
	const clamped = Math.max(0, Math.min(cursor, text.length));
	return {
		text: text.slice(0, clamped) + inserted + text.slice(clamped),
		cursor: clamped + inserted.length,
	};
}

export function isPeekPromptShortcut(evt: KeyboardEvent): boolean {
	return (
		!evt.isComposing &&
		(evt.key === "e" || evt.key === "E") &&
		evt.shiftKey &&
		(evt.ctrlKey || evt.metaKey)
	);
}

/** Peeking leaves the editor to the user. Escape must stay with Vim. */
export function peekShortcutTooltip(isPhone: boolean): string {
	return isPhone
		? "Look at the note without losing this draft."
		: "Look at the note without losing this draft. Ctrl/Cmd+Shift+E";
}

export function peekReturnHint(isPhone: boolean): string | null {
	return isPhone ? null : "Ctrl/Cmd+Shift+E returns to the prompt";
}

export function previewSelection(selection: string, maxLength = 42): string {
	const collapsed = selection.replace(/\s+/g, " ").trim();
	if (collapsed.length <= maxLength) return collapsed;
	return `${collapsed.slice(0, Math.max(0, maxLength - 1))}…`;
}
