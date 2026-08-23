import { Platform, setIcon } from "obsidian";
import type { ButtonComponent } from "obsidian";
import { createOwnedElement } from "../../utils/activeWindow";
import { peekShortcutTooltip } from "../promptShortcuts";

export const PEEK_BUTTON_LABEL = "Peek at note";
export const PEEK_BUTTON_LABEL_COMPACT = "Peek";

/**
 * Compact prompt chrome keeps the actions on one row above a software
 * keyboard. Phones always get it (landscape phones report widths past the
 * breakpoint); narrow windows on any platform do too.
 */
function useCompactPromptChrome(win: Window | null): boolean {
	return (
		Platform.isPhone ||
		(win?.innerWidth ?? Number.POSITIVE_INFINITY) <= 540
	);
}

/** Toggle the modal-level class the compact prompt-action CSS keys off. */
export function applyCompactPromptChrome(containerEl: HTMLElement): boolean {
	const compact = useCompactPromptChrome(
		containerEl.ownerDocument.defaultView,
	);
	containerEl.classList.toggle("qa-prompt-compact", compact);
	return compact;
}

/**
 * Obsidian's `ButtonComponent.setIcon()` replaces the button's children, so an
 * icon-then-label call leaves a blank control. Build the icon in its own span
 * and keep the visible label.
 */
export function stylePeekButton(button: ButtonComponent): ButtonComponent {
	const compact = useCompactPromptChrome(
		button.buttonEl.ownerDocument.defaultView,
	);
	button.setButtonText(compact ? PEEK_BUTTON_LABEL_COMPACT : PEEK_BUTTON_LABEL);
	button.setTooltip(peekShortcutTooltip(!Platform.isMobile));
	button.buttonEl.setAttribute(
		"aria-label",
		"Peek at the note. Your draft stays.",
	);
	button.buttonEl.classList.add("qa-peek-button");

	const icon = createOwnedElement(button.buttonEl, "span");
	icon.className = "qa-peek-button-icon";
	icon.setAttribute("aria-hidden", "true");
	setIcon(icon, "eye");
	button.buttonEl.prepend(icon);
	return button;
}
