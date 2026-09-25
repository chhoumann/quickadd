import { describe, expect, it } from "vitest";
import { App } from "obsidian";
import { SuggesterInputSuggest } from "./SuggesterInputSuggest";

function makeSuggest(options: string[], { caseSensitive = false, multiSelect = false } = {}) {
	const input = document.createElement("input");
	document.body.appendChild(input);
	return new SuggesterInputSuggest(new App(), input, options, caseSensitive, multiSelect);
}

const options = ["Aqua Carpatica", "Bank Stołeczny", "C", "Creative Labs", "Kawa Górska"];

describe("SuggesterInputSuggest ranking", () => {
	it("lists every option in list order for an empty query", () => {
		expect(makeSuggest(options).getSuggestions("")).toEqual(options);
	});

	it("ranks the active term of a multi-select and drops picked options", () => {
		const suggest = makeSuggest(options, { multiSelect: true });
		expect(suggest.getSuggestions("Creative Labs, c")).toEqual([
			"C",
			"Aqua Carpatica",
			"Bank Stołeczny",
		]);
		expect(suggest.getSuggestions("Creative Labs, ")).toEqual([
			"Aqua Carpatica",
			"Bank Stołeczny",
			"C",
			"Kawa Górska",
		]);
	});

	it("honours caseSensitive", () => {
		expect(makeSuggest(options, { caseSensitive: true }).getSuggestions("c")).toEqual([
			"Aqua Carpatica",
			"Bank Stołeczny",
		]);
	});

	it("highlights the matched characters of a suggestion", () => {
		const suggest = makeSuggest(options);
		suggest.getSuggestions("carp");
		const el = document.createElement("div");
		suggest.renderSuggestion("Aqua Carpatica", el);
		expect(el.innerHTML).toBe('Aqua <mark class="qa-highlight">Carp</mark>atica');
	});
});
