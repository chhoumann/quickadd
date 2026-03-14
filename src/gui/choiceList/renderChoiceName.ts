import { MarkdownRenderer, type Component } from "obsidian";

export function renderChoiceName(
	choiceName: string,
	element: HTMLSpanElement,
	component: Component
): void {
	element.innerHTML = "";
	void MarkdownRenderer.renderMarkdown(choiceName, element, "/", component);
}
