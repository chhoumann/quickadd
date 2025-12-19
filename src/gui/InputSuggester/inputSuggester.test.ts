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

	it("aligns displayItems length with items length", () => {
		const shortDisplay = ["Alpha"];
		const shortItems = ["Alpha", "Beta", "Gamma"];
		const shortSuggester = new InputSuggester(app, shortDisplay, shortItems);
		const shortDisplayItems = (shortSuggester as any).displayItems as string[];

		expect(shortDisplayItems).toHaveLength(shortItems.length);
		expect(shortDisplayItems[0]).toBe("Alpha");
		expect(shortDisplayItems[1]).toBe("Beta");
		expect(shortDisplayItems[2]).toBe("Gamma");

		const longDisplay = ["Alpha", "Beta", "Gamma"];
		const longItems = ["Alpha", "Beta"];
		const longSuggester = new InputSuggester(app, longDisplay, longItems);
		const longDisplayItems = (longSuggester as any).displayItems as string[];

		expect(longDisplayItems).toHaveLength(longItems.length);
		expect(longDisplayItems[0]).toBe("Alpha");
		expect(longDisplayItems[1]).toBe("Beta");
	});
});
