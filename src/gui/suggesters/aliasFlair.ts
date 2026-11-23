import { setIcon } from "obsidian";

/** The quick switcher's marker on a row that matched by alias: a forward arrow labelled "Alias". */
export function addAliasFlair(parent: HTMLElement, cls: string): void {
	const flair = parent.createSpan({ cls });
	flair.setAttribute("aria-label", "Alias");
	setIcon(flair, "forward");
}

/**
 * Lays out a suggestion row that matched by alias as the quick switcher does:
 * `content` holds the alias that matched with the item's own name beneath it,
 * and the flair sits on the right.
 */
export function markAliasSuggestion(el: HTMLElement, content: HTMLElement): void {
	el.addClass("mod-complex");
	content.addClass("suggestion-content");
	addAliasFlair(el.createDiv({ cls: "suggestion-aux" }), "suggestion-flair");
}
