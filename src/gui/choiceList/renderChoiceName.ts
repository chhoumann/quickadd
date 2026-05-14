import { MarkdownRenderer, type App, type Component } from "obsidian";

export function renderChoiceName(
	choiceName: string,
	element: HTMLSpanElement,
	component: Component,
	app: App,
): void {
	element.replaceChildren();
	void MarkdownRenderer.render(app, choiceName, element, "/", component);
}
