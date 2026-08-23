/**
 * The ctrl/cmd+shift chord family shared by the input prompts. Checking shift
 * is what keeps every member clear of the wide prompt's ctrl/cmd+Enter submit
 * (issue #1259), and `isComposing` keeps IME composition out of all of them.
 */
export function isModShiftShortcut(evt: KeyboardEvent, key: string): boolean {
	return (
		!evt.isComposing &&
		evt.key.toLowerCase() === key.toLowerCase() &&
		evt.shiftKey &&
		(evt.ctrlKey || evt.metaKey)
	);
}

/**
 * The keyboard gesture that skips an optional prompt: ctrl/cmd+shift+Enter.
 * Mirrors the optional suggesters' `Mod+Shift+Enter` skip binding so all
 * optional prompt surfaces share one shortcut.
 */
export function isSkipPromptShortcut(evt: KeyboardEvent): boolean {
	return isModShiftShortcut(evt, "Enter");
}

/**
 * The peek chord in its two spellings: `PEEK_SHORTCUT_KEY` is what
 * `Scope.register` and the keydown check consume, `PEEK_SHORTCUT_DISPLAY` is
 * what hints and tooltips show. Change both together.
 */
export const PEEK_SHORTCUT_KEY = "E";
export const PEEK_SHORTCUT_DISPLAY = "Ctrl/Cmd+Shift+E";

export function isPeekPromptShortcut(evt: KeyboardEvent): boolean {
	return isModShiftShortcut(evt, PEEK_SHORTCUT_KEY);
}

/** Peeking leaves the editor to the user. Escape must stay with Vim. */
export function peekShortcutTooltip(showShortcut: boolean): string {
	return showShortcut
		? `Look at the note without losing this draft. ${PEEK_SHORTCUT_DISPLAY}`
		: "Look at the note without losing this draft.";
}

export function peekReturnHint(): string {
	return `${PEEK_SHORTCUT_DISPLAY} returns to the prompt`;
}
