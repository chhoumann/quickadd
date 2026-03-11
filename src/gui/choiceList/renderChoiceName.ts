import { htmlToMarkdown, MarkdownRenderer, type Component } from "obsidian";

export function renderChoiceName(
	choiceName: string,
	element: HTMLSpanElement,
	component: Component
): void {
	element.innerHTML = "";
	const nameHTML = htmlToMarkdown(choiceName);
	void MarkdownRenderer.renderMarkdown(nameHTML, element, "/", component);
}
