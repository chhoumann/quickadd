import type { Plugin } from "obsidian";

/**
 * On a phone a QuickAdd dialog shrinks to the space above the keyboard, and a
 * choice builder's settings page keeps a keyboard-high scroll padding
 * (styles.css), which can leave the field being typed in under a pinned footer
 * or the keyboard. Obsidian's own keyboard scroll measures the document
 * selection, which for an <input> is not the field. Once the keyboard is up,
 * scroll the focused field back into view. The builder page carries
 * `.quickAddModal` too (BuilderPage).
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
