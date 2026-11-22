// @vitest-environment jsdom
import { App } from "obsidian";
import { describe, expect, it } from "vitest";
import { UserCancelError } from "../../errors/UserCancelError";
import GenericSuggester from "./genericSuggester";
import InputSuggester from "../InputSuggester/inputSuggester";

const factories = [
	{ name: "fixed", create: () => new GenericSuggester(new App(), ["Label"], ["value"]) },
	{ name: "custom", create: () => new InputSuggester(new App(), ["Label"], ["value"]) },
];

for (const { name, create } of factories) {
	describe(`${name} suggester settlement`, () => {
		it("resolves the underlying value when a suggestion is chosen", async () => {
			const prompt = create();
			prompt.selectSuggestion(prompt.getSuggestions("Label")[0], new MouseEvent("click"));
			prompt.close();
			await expect(prompt.promise).resolves.toBe("value");
		});

		it("resolves an intentional empty value on skip", async () => {
			const prompt = create();
			prompt.skip();
			await expect(prompt.promise).resolves.toBe("");
		});

		it("rejects dismissal with typed cancellation", async () => {
			const prompt = create();
			prompt.close();
			await expect(prompt.promise).rejects.toBeInstanceOf(UserCancelError);
		});
	});
}

describe("suggesters with aliases", () => {
	const labels = ["Thomas Anderson", "Neo Classic"];
	const values = ["@file:People/Thomas Anderson.md", "@file:People/Neo Classic.md"];
	const aliases = [["Neo", "The One"], []];

	for (const { name, create } of [
		{ name: "fixed", create: () => new GenericSuggester(new App(), labels, values, undefined, { aliases }) },
		{ name: "custom", create: () => new InputSuggester(new App(), labels, values, { aliases, allowCustomValue: false }) },
	]) {
		it(`${name}: finds a note by its alias and shows the alias over the note's name`, () => {
			const prompt = create();
			const [first, second] = prompt.getSuggestions("neo");
			expect([first?.item, second?.item]).toEqual(values);

			const el = document.createElement("div");
			prompt.renderSuggestion(first, el);
			expect(el.querySelector(".suggestion-title")?.textContent).toBe("Neo");
			expect(el.querySelector(".suggestion-title .suggestion-highlight")?.textContent).toBe("Neo");
			expect(el.querySelector(".suggestion-note")?.textContent).toBe("Thomas Anderson");
			expect(el.querySelector(".suggestion-flair")?.getAttribute("aria-label")).toBe("Alias");

			const own = document.createElement("div");
			prompt.renderSuggestion(second, own);
			expect(own.querySelector(".suggestion-flair")).toBeNull();
			expect(own.textContent).toBe("Neo Classic");
		});
	}
});

describe("suggester queries", () => {
	it("matches non-string display items by their text", () => {
		const items = [{ id: 1 }, { id: 2 }];
		const prompt = new GenericSuggester(new App(), [1, 2] as unknown as string[], items);

		expect(prompt.getSuggestions("2").map((match) => match.item)).toEqual([items[1]]);
	});

	it("treats an undefined query as empty and lists every item", () => {
		const prompt = new GenericSuggester(new App(), ["Alpha", "Beta"], ["a", "b"]);

		expect(prompt.getSuggestions(undefined as unknown as string).map((match) => match.item)).toEqual(["a", "b"]);
	});
});

describe("Tab autocomplete", () => {
	// Obsidian keeps the visible rows on its undocumented `chooser`; the stub
	// exposes the same shape so a test can set what the picker is showing.
	const showing = (rows: string[], selectedItem: number, query: string) => {
		const prompt = new GenericSuggester(new App(), ["Alpha", "Beta"], ["Alpha", "Beta"]);
		const internal = prompt as unknown as {
			inputEl: HTMLInputElement;
			chooser: { values: { item: string }[]; selectedItem: number };
		};
		internal.chooser.values = rows.map((item) => ({ item }));
		internal.chooser.selectedItem = selectedItem;
		internal.inputEl.value = query;
		const errors: unknown[] = [];
		const onError = (event: ErrorEvent) => {
			errors.push(event.error);
			event.preventDefault();
		};
		const pressTab = () => {
			// jsdom reports listener exceptions as window error events.
			window.addEventListener("error", onError);
			internal.inputEl.dispatchEvent(new KeyboardEvent("keydown", { code: "Tab", bubbles: true }));
			window.removeEventListener("error", onError);
		};
		return { input: internal.inputEl, pressTab, errors };
	};

	it("completes the query to the selected suggestion", () => {
		const { input, pressTab } = showing(["Alpha", "Beta"], 1, "Be");

		pressTab();

		expect(input.value).toBe("Beta");
	});

	it("keeps the typed query when nothing matches", () => {
		const { input, pressTab, errors } = showing([], 0, "no-match");

		pressTab();

		expect(errors).toEqual([]);
		expect(input.value).toBe("no-match");
	});
});
