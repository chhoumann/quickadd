import { afterEach, describe, expect, it, vi } from "vitest";
import { App, Component, MarkdownRenderer } from "obsidian";
import { renderChoiceName } from "./renderChoiceName";

describe("renderChoiceName", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("replaces existing rendered markdown instead of appending stale content", () => {
		const app = new App();
		const component = new Component();
		const element = document.createElement("span");
		const renderSpy = vi
			.spyOn(MarkdownRenderer, "render")
			.mockImplementation((_app, source, el) => {
				const rendered = document.createElement("strong");
				rendered.textContent = source;
				el.appendChild(rendered);
				return Promise.resolve();
			});

		renderChoiceName("First choice", element, component, app);
		renderChoiceName("Second choice", element, component, app);

		expect(renderSpy).toHaveBeenCalledTimes(2);
		expect(element.textContent).toBe("Second choice");
		expect(element.querySelectorAll("strong")).toHaveLength(1);
		expect(element.textContent).not.toContain("First choice");
	});
});
