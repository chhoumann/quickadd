import { MarkdownRenderer, type App, type Component } from "obsidian";

export function renderChoiceName(
	choiceName: string,
	element: HTMLSpanElement,
	component: Component,
	app: App,
): void {
	void MarkdownRenderer.render(app, choiceName, element, "/", component);
}
