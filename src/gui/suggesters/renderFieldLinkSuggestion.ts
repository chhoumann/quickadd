import { renderMatches, setIcon } from "obsidian";
import type { FieldLinkSuggestion } from "src/utils/fieldLinkValues";

/** A link FIELD row: the note by name in link color, an alias over the note it names, or `Link to [[...]]`. */
export function renderFieldLinkSuggestion(suggestion: FieldLinkSuggestion, el: HTMLElement): void {
	if (suggestion.kind === "new") {
		el.addClass("mod-complex");
		el.createDiv({ cls: "suggestion-content" })
			.createDiv({ cls: "suggestion-title", text: `Link to ${suggestion.link}` });
		setIcon(el.createDiv({ cls: "suggestion-aux" }).createSpan({ cls: "suggestion-flair" }), "link");
		return;
	}

	const { option, alias, matches } = suggestion;
	const linkCls = option.kind === "unresolved" ? "qa-field-link is-unresolved" : "qa-field-link";
	if (alias === undefined) {
		renderMatches(el.createSpan({ cls: linkCls }), option.display, matches);
		return;
	}

	el.addClass("mod-complex");
	const content = el.createDiv({ cls: "suggestion-content" });
	renderMatches(content.createDiv({ cls: "suggestion-title" }).createSpan({ cls: linkCls }), alias, matches);
	content.createDiv({ cls: "suggestion-note", text: option.display });
	const flair = el.createDiv({ cls: "suggestion-aux" }).createSpan({ cls: "suggestion-flair" });
	flair.setAttribute("aria-label", "Alias");
	setIcon(flair, "forward");
}
