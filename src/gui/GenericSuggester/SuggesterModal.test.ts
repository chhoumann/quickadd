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
