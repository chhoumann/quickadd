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
