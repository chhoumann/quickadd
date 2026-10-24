// @vitest-environment jsdom
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

		void renderChoiceName("**First** choice", element, component, app);
		void renderChoiceName("**Second** choice", element, component, app);

		expect(renderSpy).toHaveBeenCalledTimes(2);
		expect(element.textContent).toBe("**Second** choice");
		expect(element.querySelectorAll("strong")).toHaveLength(1);
		expect(element.textContent).not.toContain("First");
	});

	// Every markdown render runs every plugin's post processors, and one that
	// scans the vault per call made a 27-choice picker take ~1 s to open (#2251).
	it.each([
		"Daily note",
		"Daily note - work (inbox), v1.2; ok?",
		"\"Quoted\" isn't markdown",
		"2024 review",
		"1.5 hours",
		"example.com",
		"Café 📅 → ünïcode",
	])("renders the plain name %j as text without the markdown pipeline", (name) => {
		const element = document.createElement("span");
		element.textContent = "stale";
		const renderSpy = vi.spyOn(MarkdownRenderer, "render");

		void renderChoiceName(name, element, new Component(), new App());

		expect(renderSpy).not.toHaveBeenCalled();
		expect(element.innerHTML).toBe(`<p dir="auto">${name}</p>`);
	});

	// Each of these renders differently from its own text in Obsidian.
	it.each([
		"**bold**",
		"a _b_ c",
		"[[Link]]",
		"[a](b)",
		"<b>x</b>",
		"`code`",
		"a ==b== c",
		"#tag",
		"# Heading",
		"- item",
		"-- -",
		"+ item",
		"1. item",
		"1) item",
		"> quote",
		"    indented",
		"www.example.com",
		"https://example.com",
		"x\u2028www.example.com",
		"x\u2029www.example.com",
		"Q&amp;A",
		"$x$",
		"a %%hidden%% b",
	])("renders %j through the markdown pipeline", (name) => {
		const renderSpy = vi
			.spyOn(MarkdownRenderer, "render")
			.mockResolvedValue(undefined);

		void renderChoiceName(name, document.createElement("span"), new Component(), new App());

		expect(renderSpy).toHaveBeenCalledWith(
			expect.anything(),
			name,
			expect.anything(),
			"/",
			expect.anything(),
		);
	});
});
