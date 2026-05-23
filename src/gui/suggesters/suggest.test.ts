import type { App } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GenericTextSuggester } from "./genericTextSuggester";

function createApp(): App {
	return {
		dom: {
			appContainerEl: document.body,
		},
		keymap: {
			pushScope: vi.fn(),
			popScope: vi.fn(),
		},
	} as unknown as App;
}

describe("TextInputSuggest", () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	it("keeps focus during suggestion mousedown so click selection can run", async () => {
		const input = document.createElement("input");
		input.trigger = (eventName: string) => {
			input.dispatchEvent(new Event(eventName, { bubbles: true }));
		};
		document.body.appendChild(input);

		new GenericTextSuggester(createApp(), input, ["Adventure"]);

		input.focus();
		input.value = "Adv";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		await Promise.resolve();

		const suggestion = document.querySelector<HTMLElement>(".suggestion-item");
		expect(suggestion?.textContent).toBe("Adventure");

		const mouseDown = new MouseEvent("mousedown", {
			bubbles: true,
			cancelable: true,
		});
		suggestion?.dispatchEvent(mouseDown);

		if (!mouseDown.defaultPrevented) {
			input.blur();
		}

		suggestion?.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true }),
		);

		expect(input.value).toBe("Adventure");
	});
});
