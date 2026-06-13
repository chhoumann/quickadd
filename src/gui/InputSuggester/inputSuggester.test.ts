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

	it("suppresses the custom row when the typed value matches a displayed name", () => {
		// Folder picker shape: items are full paths, displayItems are the folder-stripped
		// names actually shown to the user (extension preserved, e.g. "note.md").
		const suggester = new InputSuggester(
			app,
			["note.md"],
			["Inbox/note.md"],
		);

		suggester.inputEl.value = "note.md";

		const suggestions = suggester.getSuggestions("note.md");

		// "note.md" already maps to Inbox/note.md, so no create row should be synthesized.
		expect(suggestions.some((s) => s.item === "note.md")).toBe(false);
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
