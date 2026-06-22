import { describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import { SuggesterInputSuggest } from "./SuggesterInputSuggest";

// Codex review follow-up: the ", "-joined multi-select text is ambiguous when an
// option label equals the join of two other labels (options "a", "b", and
// "a, b"). The per-pick onSelect event provides an UNAMBIGUOUS ordered selection
// that distinguishes picking "a" then "b" from picking the single option "a, b".
function makeSuggest(options: string[], onSelect: (item: string) => void) {
	const input = document.createElement("input");
	document.body.appendChild(input);
	const suggest = new SuggesterInputSuggest(
		new App(),
		input,
		options,
		false,
		true,
		onSelect,
	);
	return { suggest, input };
}

describe("SuggesterInputSuggest multi-select onSelect (audit)", () => {
	it("reports each picked item, distinguishing 'a' + 'b' from a literal 'a, b'", () => {
		const picksTwo: string[] = [];
		const two = makeSuggest(["a", "b", "a, b"], (item) => picksTwo.push(item));
		two.suggest.selectSuggestion("a");
		two.suggest.selectSuggestion("b");
		// Two distinct picks -> unambiguous ["a", "b"], even though the joined
		// input text "a, b" collides with the single option's label.
		expect(picksTwo).toEqual(["a", "b"]);

		const picksOne: string[] = [];
		const one = makeSuggest(["a", "b", "a, b"], (item) => picksOne.push(item));
		one.suggest.selectSuggestion("a, b");
		// A single pick of the comma-bearing option -> ["a, b"].
		expect(picksOne).toEqual(["a, b"]);
	});

	it("does not fire onSelect for single-select suggesters", () => {
		const input = document.createElement("input");
		const onSelect = vi.fn();
		const suggest = new SuggesterInputSuggest(
			new App(),
			input,
			["x", "y"],
			false,
			false,
			onSelect,
		);
		suggest.selectSuggestion("x");
		expect(onSelect).not.toHaveBeenCalled();
	});
});
