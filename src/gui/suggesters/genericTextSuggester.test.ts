import type { App } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@popperjs/core", () => ({
	createPopper: () => ({ destroy: vi.fn(), update: vi.fn(), setOptions: vi.fn(), state: { options: {} } }),
}));

import { ExclusiveSuggester } from "./exclusiveSuggester";
import { GenericTextSuggester } from "./genericTextSuggester";

function createApp(): App {
	return {
		dom: { appContainerEl: document.body },
		keymap: { pushScope: vi.fn(), popScope: vi.fn() },
	} as unknown as App;
}

function createInput(): HTMLInputElement {
	const input = document.createElement("input");
	// Obsidian's HTMLElement.trigger, which jsdom lacks.
	input.trigger = (eventName: string) => {
		input.dispatchEvent(new Event(eventName, { bubbles: true }));
	};
	document.body.appendChild(input);
	input.focus();
	return input;
}

const listedItems = () =>
	[...document.querySelectorAll(".suggestion-item")].map((el) => el.textContent);

describe("GenericTextSuggester", () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	it("ranks an exact match first, then prefix, then word-start matches", () => {
		const suggest = new GenericTextSuggester(createApp(), createInput(), [
			"align-start",
			"star-half",
			"star",
		]);
		expect(suggest.getSuggestions("star")).toEqual(["star", "star-half", "align-start"]);
	});

	it("keeps the best matches when a limit cuts the list", () => {
		// The icon picker shows 50 of ~600 icons; an exact match late in the list
		// must not be cut off by earlier substring matches.
		const suggest = new GenericTextSuggester(
			createApp(),
			createInput(),
			["box", "axe", "x"],
			1,
		);
		expect(suggest.getSuggestions("x")).toEqual(["x"]);
	});

	it("highlights the matched text and hides a trailing .md", () => {
		const input = createInput();
		const suggest = new GenericTextSuggester(createApp(), input, ["Notes/Note.MD"]);
		input.value = "note.m";
		suggest.getSuggestions(input.value);
		const el = document.createElement("div");
		suggest.renderSuggestion("Notes/Note.MD", el);
		expect(el.innerHTML).toBe('Notes/<mark class="qa-highlight">Note</mark>');
	});

	it("keeps the list closed after a pick", async () => {
		const input = createInput();
		const pickEvents: Event[] = [];
		const suggest = new GenericTextSuggester(createApp(), input, ["fetch.js", "Books/fetch.js"]);
		input.value = "fetch";
		await suggest.onInputChanged();
		expect(listedItems()).toEqual(["fetch.js", "Books/fetch.js"]);

		input.addEventListener("input", (event) => pickEvents.push(event));
		suggest.selectSuggestion("Books/fetch.js");
		expect(input.value).toBe("Books/fetch.js");
		expect(pickEvents).toHaveLength(1);

		// In Obsidian the input handler is debounced, so the pick's own input
		// event reaches it after selectSuggestion() has closed the list.
		await suggest.onInputChanged(pickEvents[0]);
		expect(document.querySelector(".suggestion-container")).toBeNull();
		expect(input.getAttribute("aria-expanded")).toBe("false");

		input.value = "Books/f";
		await suggest.onInputChanged(new Event("input"));
		expect(listedItems()).toEqual(["Books/fetch.js"]);
	});
});

describe("ExclusiveSuggester", () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	it("leaves out the items already chosen", () => {
		const suggest = new ExclusiveSuggester(
			createApp(),
			createInput(),
			["Projects", "Projects/Archive", "Scripts"],
			["Projects"],
		);
		expect(suggest.getSuggestions("proj")).toEqual(["Projects/Archive"]);

		suggest.updateCurrentItems([]);
		expect(suggest.getSuggestions("proj")).toEqual(["Projects", "Projects/Archive"]);
	});
});
