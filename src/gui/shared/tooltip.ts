import { setTooltip } from "obsidian";

/**
 * Svelte action attaching Obsidian's native (styled) tooltip to an element.
 * The plain HTML `title` attribute does not render reliably inside Obsidian's
 * Electron window, so use this instead for hover hints.
 *
 *   <span use:tooltip={"Explains the term"}>Executable</span>
 */
export function tooltip(node: HTMLElement, text: string) {
	if (text) setTooltip(node, text);
	return {
		update(next: string) {
			setTooltip(node, next ?? "");
		},
	};
}
