import { beforeEach, describe, expect, it } from "vitest";
import { App } from "obsidian";
import InputSuggester from "./inputSuggester";

describe("InputSuggester", () => {
	let app: App;

	beforeEach(() => {
		app = new App();
	});

	it("places fuzzy matches before custom input suggestions", () => {
		const suggester = new InputSuggester(
			app,
			["Alpha file", "Beta note"],
			["Alpha file", "Beta note"]
		);

		suggester.inputEl.value = "bet";

		const suggestions = suggester.getSuggestions("bet");

		expect(suggestions[0]?.item).toBe("Beta note");
		expect(suggestions[suggestions.length - 1]?.item).toBe("bet");
	});

	it("avoids duplicating existing items as custom input", () => {
		const suggester = new InputSuggester(
			app,
			["Meeting notes"],
			["Meeting notes"]
		);

		suggester.inputEl.value = "Meeting notes";

		const suggestions = suggester.getSuggestions("Meeting notes");

		const matchingEntries = suggestions.filter(
			(suggestion) => suggestion.item === "Meeting notes"
		);

		expect(matchingEntries).toHaveLength(1);
	});
});
