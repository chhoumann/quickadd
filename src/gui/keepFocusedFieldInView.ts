import type { Plugin } from "obsidian";

/**
 * On a phone a QuickAdd dialog shrinks to the space above the keyboard
 * (styles.css), which can leave the field being typed in below its scroll
 * area, under a pinned footer. Obsidian's own keyboard scroll measures the
 * document selection, which for an <input> is not the field. Once the keyboard
 * is up, scroll the focused field back into view.
 */
export function keepFocusedFieldInView(plugin: Plugin): void {
	const onKeyboardShown = () => {
		const field = activeDocument.activeElement;
		if (field?.instanceOf(HTMLElement) && field.closest(".quickAddModal")) {
			field.scrollIntoView({ block: "nearest" });
		}
	};
	// Capacitor's Keyboard plugin dispatches these on window in the mobile app.
	window.addEventListener("keyboardDidShow", onKeyboardShown);
	plugin.register(() => window.removeEventListener("keyboardDidShow", onKeyboardShown));
}
