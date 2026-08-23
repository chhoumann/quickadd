import { Platform, setIcon } from "obsidian";
import type { ButtonComponent } from "obsidian";
import { peekShortcutTooltip, useCompactPeekChrome } from "./promptPeekPhase";

export const PEEK_BUTTON_LABEL = "Peek at note";
export const PEEK_BUTTON_LABEL_COMPACT = "Peek";

export function peekButtonLabel(compact: boolean): string {
	return compact ? PEEK_BUTTON_LABEL_COMPACT : PEEK_BUTTON_LABEL;
}

export function applyCompactPromptChrome(containerEl: HTMLElement): boolean {
	const compact = useCompactPeekChrome(
		Platform.isPhone,
		containerEl.ownerDocument.defaultView?.innerWidth ??
			Number.POSITIVE_INFINITY,
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
	const viewportWidth =
		button.buttonEl.ownerDocument.defaultView?.innerWidth ??
		Number.POSITIVE_INFINITY;
	const compact = useCompactPeekChrome(Platform.isPhone, viewportWidth);
	button.setButtonText(peekButtonLabel(compact));
	button.setTooltip(peekShortcutTooltip(Platform.isPhone, viewportWidth));
	button.buttonEl.setAttribute(
		"aria-label",
		"Peek at the note. Your draft stays.",
	);
	button.buttonEl.classList.add("qa-peek-button");

	const icon = button.buttonEl.ownerDocument.createElement("span");
	icon.className = "qa-peek-button-icon";
	icon.setAttribute("aria-hidden", "true");
	setIcon(icon, "eye");
	button.buttonEl.prepend(icon);
	return button;
}
