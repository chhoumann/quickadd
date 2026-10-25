import { MarkdownRenderer, type App, type Component } from "obsidian";
import { createOwnedElement } from "../../utils/activeWindow";

/**
 * Characters no Markdown construct uses: letters, digits, spaces, `,.'"?;()-`,
 * and anything outside ASCII. The Unicode line and paragraph separators are
 * left to the renderer, since a parser may treat them as line breaks.
 */
const PLAIN_CHARACTERS = /^[a-z0-9 ,.'"?;()\-\u0080-\u2027\u202a-\u{10ffff}]+$/iu;
/** Openings that still make a list or an indented code block from those characters. */
const BLOCK_OPENING = /^(?:[-\s]|\d+[.)](?:\s|$))/;

/** Whether Obsidian would render the name as exactly its own text. */
function isPlainName(name: string): boolean {
	return (
		PLAIN_CHARACTERS.test(name) &&
		!BLOCK_OPENING.test(name) &&
		!/www\./i.test(name)
	);
}

/**
 * Renders a choice name, which may hold Markdown or HTML. Plain names skip the
 * Markdown renderer because it runs every plugin's post processors, so one slow
 * post processor would otherwise be paid once per row.
 */
export async function renderChoiceName(
	choiceName: string,
	element: HTMLElement,
	component: Component,
	app: App,
): Promise<void> {
	element.replaceChildren();
	if (isPlainName(choiceName)) {
		const paragraph = createOwnedElement(element, "p");
		paragraph.dir = "auto";
		paragraph.textContent = choiceName;
		element.appendChild(paragraph);
		return;
	}
	await MarkdownRenderer.render(app, choiceName, element, "/", component);
}
