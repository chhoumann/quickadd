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

	it("tolerates undefined query input", () => {
		const suggester = new InputSuggester(
			app,
			["Alpha file", "Beta note"],
			["Alpha file", "Beta note"]
		);

		expect(() =>
			suggester.getSuggestions(undefined as unknown as string),
		).not.toThrow();
	});

	it("omits the custom create row when allowCustomValue is false", () => {
		const suggester = new InputSuggester(
			app,
			["Existing note"],
			["Existing note"],
			{ allowCustomValue: false },
		);

		suggester.inputEl.value = "Brand new note";

		const suggestions = suggester.getSuggestions("Brand new note");

		expect(
			suggestions.some((s) => s.item === "Brand new note"),
		).toBe(false);
	});

	it("keeps a typed display label submittable for generic callers (no valueExists)", () => {
		// Public api.suggester / |text format syntax shape: display labels differ from
		// the underlying values, and allowCustomInput lets the user submit typed text
		// that is NOT an actual item. Typing a string equal to a display LABEL (not a
		// value) must still yield a submittable custom row — it is not an existing target.
		const suggester = new InputSuggester(
			app,
			["Apple Label", "Banana Label"],
			["apple-id", "banana-id"],
		);

		suggester.inputEl.value = "Apple Label";

		const suggestions = suggester.getSuggestions("Apple Label");

		// The literal typed label is still offered as a custom value (regression guard).
		expect(suggestions[suggestions.length - 1]?.item).toBe("Apple Label");
	});

	it("suppresses the custom row when valueExists reports an existing target", () => {
		const suggester = new InputSuggester(app, ["Alpha"], ["Alpha"], {
			valueExists: (value) => value === "Existing",
		});

		suggester.inputEl.value = "Existing";

		const suggestions = suggester.getSuggestions("Existing");

		expect(suggestions.some((s) => s.item === "Existing")).toBe(false);
	});

	it("still offers a create row for a genuinely new value when allowed", () => {
		const suggester = new InputSuggester(app, ["Alpha"], ["Inbox/Alpha.md"], {
			allowCustomValue: true,
			valueExists: () => false,
		});

		suggester.inputEl.value = "Brand new";

		const suggestions = suggester.getSuggestions("Brand new");

		expect(suggestions[suggestions.length - 1]?.item).toBe("Brand new");
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
