import { beforeEach, describe, expect, it } from "vitest";
import { App } from "obsidian";
import GenericSuggester from "./genericSuggester";

describe("GenericSuggester", () => {
	let app: App;

	beforeEach(() => {
		app = new App();
	});

	it("normalizes non-string display items for fuzzy matching", () => {
		const items = [{ id: 1 }, { id: 2 }];
		const displayItems = items as unknown as string[];

		const suggester = new GenericSuggester(app, displayItems, items);

		expect(() => suggester.getSuggestions("1")).not.toThrow();
	});

	it("tolerates undefined query input", () => {
		const items = ["Alpha", "Beta"];
		const suggester = new GenericSuggester(app, items, items);

		expect(() =>
			suggester.getSuggestions(undefined as unknown as string),
		).not.toThrow();
	});

});
