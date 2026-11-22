// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import { SuggesterInputSuggest } from "./SuggesterInputSuggest";

function makeSuggest(
	options: string[],
	{ caseSensitive = false, multiSelect = false, onSelect = undefined as ((item: string) => void) | undefined } = {},
) {
	const input = document.createElement("input");
	document.body.appendChild(input);
	return new SuggesterInputSuggest(new App(), input, options, caseSensitive, multiSelect, onSelect);
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

// The ", "-joined multi-select text is ambiguous when an option label equals the
// join of two others ("a", "b" and "a, b"), so each pick is reported on its own.
describe("SuggesterInputSuggest onSelect", () => {
	it("reports each multi-select pick, telling 'a' + 'b' apart from a literal 'a, b'", () => {
		const picksTwo: string[] = [];
		const two = makeSuggest(["a", "b", "a, b"], { multiSelect: true, onSelect: (item) => picksTwo.push(item) });
		two.selectSuggestion("a");
		two.selectSuggestion("b");
		expect(picksTwo).toEqual(["a", "b"]);

		const picksOne: string[] = [];
		const one = makeSuggest(["a", "b", "a, b"], { multiSelect: true, onSelect: (item) => picksOne.push(item) });
		one.selectSuggestion("a, b");
		expect(picksOne).toEqual(["a, b"]);
	});

	it("does not fire for single-select suggesters", () => {
		const onSelect = vi.fn();
		makeSuggest(["x", "y"], { onSelect }).selectSuggestion("x");
		expect(onSelect).not.toHaveBeenCalled();
	});
});
