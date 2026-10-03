import { App, TFile } from "obsidian";
import { describe, expect, it } from "vitest";
import { renderNotePathSuggestion } from "./renderNotePathSuggestion";

const path = "People/Thomas Anderson.md";

function appWithNote(): App {
	const file = Object.assign(new TFile(), {
		path,
		name: "Thomas Anderson.md",
		basename: "Thomas Anderson",
		extension: "md",
	});
	const app = new App();
	app.vault.getAbstractFileByPath = (candidate: string) => (candidate === path ? file : null);
	app.metadataCache.getFileCache = () => null;
	return app;
}

function render(matches: [number, number][]) {
	const el = document.createElement("div");
	// Search text "Thomas Anderson People/Thomas Anderson.md": the path starts at 16.
	renderNotePathSuggestion(el, path, appWithNote(), { matches, pathOffset: 16 });
	const highlights = (selector: string) =>
		Array.from(el.querySelectorAll(`${selector} .suggestion-highlight`), (span) => span.textContent);
	return {
		title: el.querySelector(".suggestion-title")?.textContent,
		note: el.querySelector(".suggestion-note")?.textContent,
		titleHighlights: highlights(".suggestion-title"),
		noteHighlights: highlights(".suggestion-note"),
	};
}

describe("renderNotePathSuggestion highlights", () => {
	it("highlights a match in the note's name", () => {
		expect(render([[7, 15]])).toEqual({
			title: "Thomas Anderson",
			note: path,
			titleHighlights: ["Anderson"],
			noteHighlights: [],
		});
	});

	it("highlights a match in the path on the path line", () => {
		expect(render([[16, 25]])).toEqual({
			title: "Thomas Anderson",
			note: path,
			titleHighlights: [],
			noteHighlights: ["People/Th"],
		});
	});
});
