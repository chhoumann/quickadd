import { beforeEach, describe, expect, it } from "vitest";
import { App } from "obsidian";
import GenericSuggester from "./genericSuggester";

// Drives the undocumented Tab autocomplete handler the same way Obsidian does:
// a "Tab" keydown on inputEl while `chooser` holds the current suggestions.
// jsdom swallows listener exceptions (routing them to window error events
// instead of re-throwing), so capture any error the handler throws and surface
// it to the caller for assertion.
function pressTab(suggester: GenericSuggester<unknown>): void {
	const inputEl = (suggester as unknown as { inputEl: HTMLInputElement })
		.inputEl;
	let captured: unknown;
	const onError = (event: ErrorEvent) => {
		captured = event.error ?? new Error(event.message);
		event.preventDefault();
	};
	window.addEventListener("error", onError);
	try {
		inputEl.dispatchEvent(
			new KeyboardEvent("keydown", { code: "Tab", bubbles: true }),
		);
	} finally {
		window.removeEventListener("error", onError);
	}
	if (captured) throw captured;
}

describe("GenericSuggester Tab autocomplete (audit: api-suggester / prompts-gui-generic-suggester)", () => {
	let app: App;

	beforeEach(() => {
		app = new App();
	});

	it("does not throw on Tab when the query matches nothing (empty chooser values)", () => {
		const items = ["Alpha", "Beta"];
		const suggester = new GenericSuggester(app, items, items);

		const internal = suggester as unknown as {
			inputEl: HTMLInputElement;
			chooser: { values: unknown[]; selectedItem: number };
		};
		// Simulate a query that filtered out every suggestion.
		internal.chooser.values = [];
		internal.chooser.selectedItem = 0;
		internal.inputEl.value = "no-match";

		expect(() => pressTab(suggester)).not.toThrow();
		// The typed query is kept untouched (the fallback `?? value`).
		expect(internal.inputEl.value).toBe("no-match");
	});

	it("still completes to the selected suggestion's item when one exists", () => {
		const items = ["Alpha", "Beta"];
		const suggester = new GenericSuggester(app, items, items);

		const internal = suggester as unknown as {
			inputEl: HTMLInputElement;
			chooser: { values: { item: string }[]; selectedItem: number };
		};
		internal.chooser.values = [{ item: "Alpha" }, { item: "Beta" }];
		internal.chooser.selectedItem = 1;
		internal.inputEl.value = "Be";

		pressTab(suggester);
		expect(internal.inputEl.value).toBe("Beta");
	});
});
