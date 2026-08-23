import { Platform, setIcon } from "obsidian";
import type { ButtonComponent } from "obsidian";
import { peekShortcutTooltip } from "./promptPeekPhase";

export const PEEK_BUTTON_LABEL = "Peek at note";

/**
 * Obsidian's `ButtonComponent.setIcon()` replaces the button's children, so an
 * icon-then-label call leaves a blank control. Build the icon in its own span
 * and keep the visible label.
 */
export function stylePeekButton(button: ButtonComponent): ButtonComponent {
	button.setButtonText(PEEK_BUTTON_LABEL);
	button.setTooltip(peekShortcutTooltip(Platform.isPhone));
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
