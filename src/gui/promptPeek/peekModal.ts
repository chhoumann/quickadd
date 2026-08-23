export const PEEK_INSTANT_CLASS = "qa-prompt-peek-instant";

type PeekModal = {
	containerEl: HTMLElement;
	close(): void;
	open(): void;
};

/** Skip Obsidian's modal animation so peek does not flash a squished dialog. */
export function closeModalForPeek(modal: PeekModal): void {
	modal.containerEl.addClass(PEEK_INSTANT_CLASS);
	modal.close();
}

export function remountModalFromPeek(
	modal: PeekModal,
	rebuild: () => void,
): void {
	modal.containerEl.addClass(PEEK_INSTANT_CLASS);
	rebuild();
	modal.open();
	const el = modal.containerEl;
	const ownerWindow = el.ownerDocument.defaultView;
	if (!ownerWindow) {
		el.removeClass(PEEK_INSTANT_CLASS);
		return;
	}
	ownerWindow.requestAnimationFrame(() => {
		ownerWindow.requestAnimationFrame(() => {
			el.removeClass(PEEK_INSTANT_CLASS);
		});
	});
}