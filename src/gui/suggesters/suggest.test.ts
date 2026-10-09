// @vitest-environment jsdom
import type { App } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("src/logger/logManager", () => ({
	log: {
		logError: vi.fn(),
		logMessage: vi.fn(),
		logWarning: vi.fn(),
	},
}));

import { GenericTextSuggester } from "./genericTextSuggester";
import { TextInputSuggest } from "./suggest";

// A suggester whose getSuggestions stays pending until the test resolves it, so
// we can interleave destroy() with an in-flight async lookup.
class DeferredSuggest extends TextInputSuggest<string> {
	public resolvePending: ((items: string[]) => void) | null = null;
	getSuggestions(): Promise<string[]> {
		return new Promise((resolve) => {
			this.resolvePending = resolve;
		});
	}
	renderSuggestion(item: string, el: HTMLElement): void {
		el.textContent = item;
	}
	selectSuggestion(): void {
		// no-op for tests
	}
}

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

	it("lets a path wrap after its slashes without changing the row's text", async () => {
		const input = document.createElement("input");
		document.body.appendChild(input);
		const suggest = new GenericTextSuggester(createApp(), input, ["Scripts/Books/fetch.js"]);

		input.focus();
		input.value = "fetch";
		await suggest.onInputChanged();

		const row = document.querySelector<HTMLElement>(".suggestion-item");
		expect(row?.innerHTML).toBe(
			'Scripts/<wbr>Books/<wbr><mark class="qa-highlight">fetch</mark>.js',
		);
		expect(row?.textContent).toBe("Scripts/Books/fetch.js");
		expect(document.querySelector(".suggestion-container")?.classList).toContain(
			"qa-text-input-suggest",
		);
	});

	it("leaves a structured row's own path span alone", async () => {
		// Such spans are nowrap + ellipsis, and Chromium lets <wbr> break nowrap.
		class PathRowSuggest extends DeferredSuggest {
			renderSuggestion(item: string, el: HTMLElement): void {
				el.createSpan({ cls: "suggestion-sub-text", text: item });
			}
		}
		const input = document.createElement("input");
		document.body.appendChild(input);
		const suggest = new PathRowSuggest(createApp(), input);

		input.focus();
		const opened = suggest.onInputChanged();
		suggest.resolvePending?.(["People/Nora.md"]);
		await opened;

		expect(document.querySelector(".suggestion-item")?.innerHTML).toBe(
			'<span class="suggestion-sub-text">People/Nora.md</span>',
		);
	});

	it("exposes the input as a combobox wired to the listbox and active option", async () => {
		const input = document.createElement("input");
		input.trigger = (eventName: string) => {
			input.dispatchEvent(new Event(eventName, { bubbles: true }));
		};
		document.body.appendChild(input);

		const suggest = new GenericTextSuggester(createApp(), input, [
			"alpha",
			"alpine",
			"beta",
		]);

		expect(input.getAttribute("role")).toBe("combobox");
		expect(input.getAttribute("aria-autocomplete")).toBe("list");
		expect(input.getAttribute("aria-expanded")).toBe("false");
		expect(input.getAttribute("aria-haspopup")).toBe("listbox");

		const listboxId = input.getAttribute("aria-controls");
		expect(listboxId).toMatch(/^qa-suggest-listbox-\d+$/);

		input.focus();
		input.value = "al";
		await suggest.onInputChanged();

		expect(input.getAttribute("aria-expanded")).toBe("true");
		expect(input.getAttribute("aria-controls")).toBe(listboxId);

		const listbox = document.getElementById(listboxId ?? "");
		expect(listbox?.getAttribute("role")).toBe("listbox");
		const options = [
			...listbox?.querySelectorAll<HTMLElement>('[role="option"]') ?? [],
		];
		expect(options.map((option) => option.textContent)).toEqual([
			"alpha",
			"alpine",
		]);
		expect(input.getAttribute("aria-activedescendant")).toBe(options[0]?.id);

		for (const option of options) {
			option.scrollIntoView = () => undefined;
		}
		const scope = (
			suggest as unknown as { scope: { trigger: (key: string) => void } }
		).scope;
		scope.trigger("ArrowDown");
		expect(input.getAttribute("aria-activedescendant")).toBe(options[1]?.id);

		suggest.close();
		expect(input.getAttribute("aria-expanded")).toBe("false");
		expect(input.hasAttribute("aria-activedescendant")).toBe(false);
	});
});

describe("TextInputSuggest resource lifecycle", () => {
	let app: App;
	let input: HTMLInputElement;

	const listIsOpen = () => Boolean(document.querySelector(".suggestion-container"));

	beforeEach(() => {
		app = createApp();
		input = document.createElement("input");
		document.body.appendChild(input);
		// Suggestions only open under the focused input.
		input.focus();
	});

	afterEach(() => {
		document.body.replaceChildren();
		vi.restoreAllMocks();
	});

	it("adds its global listeners once per opening instead of once per keystroke", async () => {
		const suggest = new GenericTextSuggester(app, input, ["abcde", "abcxyz"]);
		const add = vi.spyOn(document, "addEventListener");
		const remove = vi.spyOn(document, "removeEventListener");
		const scrollListeners = (spy: typeof add) => spy.mock.calls.filter(([type]) => type === "scroll").length;

		// Every keystroke re-opens the list to refresh it.
		for (const value of ["a", "ab", "abc"]) {
			input.value = value;
			await suggest.onInputChanged();
		}
		expect(listIsOpen()).toBe(true);
		expect(scrollListeners(add)).toBe(1);

		suggest.close();
		expect(listIsOpen()).toBe(false);
		expect(scrollListeners(remove)).toBe(1);

		input.value = "abcd";
		await suggest.onInputChanged();
		expect(scrollListeners(add)).toBe(2);
	});

	it("keeps the instance registered after close() so a later same-class suggester destroys it", async () => {
		const destroySpy = vi.spyOn(GenericTextSuggester.prototype, "destroy");

		const first = new GenericTextSuggester(app, input, ["abcde"]);
		input.value = "a";
		await first.onInputChanged();
		// Confirm it actually opened (close() early-returns when never opened,
		// which would skip the historically-buggy unregister path).
		expect(listIsOpen()).toBe(true);

		// close() only hides the dropdown; it must NOT unregister the instance.
		first.close();
		expect(destroySpy).not.toHaveBeenCalled();

		// Attaching a new suggester of the same class to the same input must
		// find and destroy the previous (still-registered) instance via the
		// constructor dedup. If close() had unregistered it, the old instance's
		// input listeners would leak and produce duplicate popups.
		new GenericTextSuggester(app, input, ["abcde"]);
		expect(destroySpy).toHaveBeenCalledTimes(1);
	});

	it("does not re-open when an in-flight async getSuggestions resolves after destroy()", async () => {
		const suggest = new DeferredSuggest(app, input);

		input.value = "a";
		const inFlight = suggest.onInputChanged(); // awaits the pending lookup
		expect(suggest.resolvePending).not.toBeNull();

		// Destroy mid-flight, then let the lookup resolve. A destroyed instance
		// must not spawn an orphaned popup.
		suggest.destroy();
		suggest.resolvePending?.(["a", "ab"]);
		await inFlight;

		expect(listIsOpen()).toBe(false);
	});

	it("does not reopen a note field hidden while its lookup was pending", async () => {
		const suggest = new DeferredSuggest(app, input);
		input.value = "a";
		const inFlight = suggest.onInputChanged();
		input.hidden = true;
		suggest.resolvePending?.(["a", "ab"]);
		await inFlight;
		expect(app.keymap.pushScope).not.toHaveBeenCalled();
		expect(listIsOpen()).toBe(false);
		suggest.destroy();
	});

	it("discards a lookup after its field is closed and shown again", async () => {
		const suggest = new DeferredSuggest(app, input);
		input.value = "a";
		const inFlight = suggest.onInputChanged();
		input.hidden = true;
		suggest.close();
		input.hidden = false;
		suggest.resolvePending?.(["a", "ab"]);
		await inFlight;
		expect(app.keymap.pushScope).not.toHaveBeenCalled();
		expect(listIsOpen()).toBe(false);
		suggest.destroy();
	});

	it("ignores delayed input updates inside a hidden form field", async () => {
		const field = document.createElement("div");
		field.hidden = true;
		field.appendChild(input);
		document.body.appendChild(field);
		const suggest = new DeferredSuggest(app, input);
		await suggest.onInputChanged();
		expect(suggest.resolvePending).toBeNull();
		expect(app.keymap.pushScope).not.toHaveBeenCalled();
		suggest.destroy();
	});

	it("ignores onInputChanged fired after destroy() (pending debounce)", async () => {
		const suggest = new GenericTextSuggester(app, input, ["abcde"]);

		suggest.destroy();
		input.value = "a";
		await suggest.onInputChanged();

		expect(listIsOpen()).toBe(false);
	});

	it("keeps replacing same-class suggesters discoverable after the registry self-prunes", () => {
		// First instance: registers under this input.
		new GenericTextSuggester(app, input, ["x"]);

		// Second instance on the same input destroys the first; that destroy empties
		// the input's per-class map and prunes the input from instanceMap. The new
		// instance must re-attach itself, or it becomes invisible to later dedup.
		const second = new GenericTextSuggester(app, input, ["x"]);
		const secondDestroy = vi.spyOn(second, "destroy");

		// Third instance must find and destroy the second (proving it stayed
		// tracked). Without the re-attach fix the second is orphaned: its input
		// listeners leak and a duplicate popup can spawn.
		new GenericTextSuggester(app, input, ["x"]);

		expect(secondDestroy).toHaveBeenCalledTimes(1);
	});
});

describe("TextInputSuggest placement in a prompt", () => {
	// jsdom has no layout, so each test states the geometry: the input and the
	// prompt's action bar in viewport pixels, the height the list renders at,
	// and an 800px tall viewport.
	let input: HTMLInputElement;
	let actions: HTMLElement;
	let geometry: {
		input: [top: number, bottom: number];
		actionsTop: number;
		listHeight: number;
		inputX?: [left: number, width: number];
	};

	const box = (top: number, bottom: number, left = 0, width = 300) =>
		({ top, bottom, height: bottom - top, left, right: left + width, width, x: left, y: top }) as DOMRect;

	beforeEach(() => {
		const modal = document.createElement("div");
		modal.className = "modal";
		input = document.createElement("input");
		actions = document.createElement("div");
		actions.className = "qa-prompt-actions";
		modal.append(input, actions);
		document.body.appendChild(modal);
		input.focus();
		vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(800);
		vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1000);
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
			if (this === input) return box(...geometry.input, ...(geometry.inputX ?? []));
			if (this === actions) return box(geometry.actionsTop, geometry.actionsTop + 30);
			// The list's containing block starts at the viewport's origin.
			if (this.classList.contains("suggestion-container")) {
				const top = parseFloat(this.style.top) || 0;
				return box(top, top + geometry.listHeight);
			}
			return box(0, 0);
		});
	});

	afterEach(() => {
		document.body.replaceChildren();
		vi.restoreAllMocks();
	});

	const list = () => document.querySelector<HTMLElement>(".suggestion-container")!;
	const side = () => (parseFloat(list().style.top) < geometry.input[0] ? "above" : "below");

	async function openSuggest(items = ["Lead", "Lean"]): Promise<GenericTextSuggester> {
		const suggest = new GenericTextSuggester(createApp(), input, items);
		input.value = "Le";
		await suggest.onInputChanged();
		return suggest;
	}

	it("opens 4px below the input, exactly as wide as it", async () => {
		geometry = { input: [100, 130], actionsTop: 600, listHeight: 47 };
		await openSuggest();
		expect(list().style.top).toBe("134px");
		expect(list().style.left).toBe("0px");
		expect(list().style.width).toBe("300px");
	});

	it.each([
		// A phone's Macro builder script field, 108px wide beside Browse and Add.
		["a narrow input", 1000, [28, 108], "300px", "28px"],
		["a narrow input near the right edge", 390, [250, 108], "300px", "90px"],
		["a narrow input in a viewport narrower than the minimum", 250, [20, 108], "250px", "0px"],
	] as const)("is at least 300px wide beside %s, inside the viewport", async (_name, viewportWidth, inputX, width, left) => {
		vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(viewportWidth);
		geometry = { input: [100, 130], actionsTop: 600, listHeight: 47, inputX: [...inputX] };
		await openSuggest();
		expect(list().style.width).toBe(width);
		expect(list().style.left).toBe(left);
	});

	// Input 484-514, action bar from 546: 32px below the input, 4px gaps on
	// either side of the list.
	it.each([
		[24, "below"], // ends 4px over the bar
		[25, "above"],
		[180, "above"],
	])("opens a %ipx list below the last input only when it clears the action bar", async (listHeight, expected) => {
		geometry = { input: [484, 514], actionsTop: 546, listHeight };
		await openSuggest();
		expect(side()).toBe(expected);
	});

	it("opens above, ending 4px over the input", async () => {
		geometry = { input: [484, 514], actionsTop: 546, listHeight: 180 };
		await openSuggest();
		expect(list().style.top).toBe(`${484 - 4 - 180}px`);
	});

	it("takes the roomier side, shortened, when neither side holds the list", async () => {
		// 4 + 47 = 51px is needed on either side; 36px exist above, 24px before the bar.
		geometry = { input: [40, 70], actionsTop: 102, listHeight: 47 };
		await openSuggest();
		expect(list().style.top).toBe("0px");
		expect(list().style.maxHeight).toBe("36px");
	});

	// Input 300-330, action bar from 546: 208px of room below the input.
	it("keeps a list that would fit above below its input, shortened to end over the action bar", async () => {
		geometry = { input: [300, 330], actionsTop: 546, listHeight: 250 };
		await openSuggest();
		expect(list().style.top).toBe("334px");
		expect(list().style.maxHeight).toBe("208px");
	});

	it("keeps a list that would fit above below its input, shortened to the viewport", async () => {
		actions.remove();
		geometry = { input: [500, 530], actionsTop: 0, listHeight: 400 };
		await openSuggest();
		expect(list().style.top).toBe("534px");
		expect(list().style.maxHeight).toBe("266px");
	});

	it.each([
		[488, "below"], // 150px below the input
		[487, "above"],
	])("keeps a list below with at least 150px of room there (action bar at %i)", async (actionsTop, expected) => {
		geometry = { input: [300, 330], actionsTop, listHeight: 250 };
		await openSuggest();
		expect(side()).toBe(expected);
	});

	it("ignores inputs outside a prompt with an action bar", async () => {
		actions.remove();
		geometry = { input: [484, 514], actionsTop: 546, listHeight: 47 };
		await openSuggest();
		expect(side()).toBe("below");
	});

	it("stays inside the visible viewport when it opens above", async () => {
		// Pinch-zoomed: the visible viewport starts at y=350, so 130px are left
		// above an input at 484.
		Object.defineProperty(window, "visualViewport", {
			configurable: true,
			value: { offsetLeft: 0, offsetTop: 350, width: 1000, height: 450 },
		});
		try {
			geometry = { input: [484, 514], actionsTop: 546, listHeight: 180 };
			await openSuggest();
			expect(list().style.top).toBe("350px");
			expect(list().style.maxHeight).toBe("130px");
		} finally {
			Reflect.deleteProperty(window, "visualViewport");
		}
	});

	it("opens above when the viewport has no room below", async () => {
		actions.remove();
		geometry = { input: [700, 730], actionsTop: 0, listHeight: 200 };
		await openSuggest();
		expect(side()).toBe("above");
	});

	it("opens above when the on-screen keyboard leaves no room below", async () => {
		// A phone's keyboard covers 800 - 345 = 455 down; the visual viewport
		// still reports the full 800px, as on Android.
		actions.remove();
		document.documentElement.style.setProperty("--keyboard-height", "345px");
		try {
			geometry = { input: [400, 430], actionsTop: 0, listHeight: 100 };
			await openSuggest();
			expect(side()).toBe("above");
		} finally {
			document.documentElement.style.removeProperty("--keyboard-height");
		}
	});

	it("moves above when the keyboard comes up under an open list", async () => {
		actions.remove();
		geometry = { input: [400, 430], actionsTop: 0, listHeight: 100 };
		await openSuggest();
		expect(side()).toBe("below");

		document.documentElement.style.setProperty("--keyboard-height", "345px");
		try {
			window.dispatchEvent(new Event("keyboardDidShow"));
			expect(side()).toBe("above");
		} finally {
			document.documentElement.style.removeProperty("--keyboard-height");
		}
	});

	it("stays below with the keyboard down", async () => {
		actions.remove();
		geometry = { input: [400, 430], actionsTop: 0, listHeight: 100 };
		await openSuggest();
		expect(side()).toBe("below");
	});

	it("re-decides on each refresh as the list's height changes", async () => {
		geometry = { input: [484, 514], actionsTop: 546, listHeight: 47 };
		const suggest = await openSuggest();
		expect(side()).toBe("above");

		geometry.listHeight = 20;
		await suggest.onInputChanged();
		expect(side()).toBe("below");
	});

	it("re-places the list when a multi-select pick refreshes it in place", async () => {
		// A filtered list fits below; after the pick the input is cleared and the
		// unfiltered list that stays open would reach the action bar.
		geometry = { input: [484, 514], actionsTop: 560, listHeight: 30 };
		const suggest = new GenericTextSuggester(createApp(), input, ["Ann", "Bob"]);
		input.value = "Ann";
		await suggest.onInputChanged();
		expect(side()).toBe("below");

		const keepOpenRefresh = () => {
			input.value = "";
			return suggest.onInputChanged(
				Object.assign(new Event("input"), { fromCompletion: true, keepOpen: true }),
			);
		};
		geometry.listHeight = 90;
		await keepOpenRefresh();
		expect(side()).toBe("above");

		// A new chip row moved the input down.
		geometry = { input: [300, 330], actionsTop: 560, listHeight: 30 };
		await keepOpenRefresh();
		expect(list().style.top).toBe("334px");
	});

	it("follows its input when the form scrolls", async () => {
		geometry = { input: [300, 330], actionsTop: 600, listHeight: 47 };
		await openSuggest();
		expect(list().style.top).toBe("334px");

		geometry.input = [200, 230];
		input.closest(".modal")!.dispatchEvent(new Event("scroll"));
		expect(list().style.top).toBe("234px");
	});
});

describe("TextInputSuggest focus", () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	it("does not open under an input that lost focus before the debounced handler ran", async () => {
		const input = document.createElement("input");
		const other = document.createElement("input");
		document.body.append(input, other);
		const suggest = new GenericTextSuggester(createApp(), input, ["Adventure"]);

		input.focus();
		input.value = "Adv";
		other.focus();
		await suggest.onInputChanged();

		expect(input.getAttribute("aria-expanded")).toBe("false");
		expect(document.querySelector(".suggestion-container")).toBeNull();
		suggest.destroy();
	});
});

describe("TextInputSuggest Enter", () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	it("picks from the typed text's list when Enter beats the debounced refresh (#2142)", async () => {
		const input = document.createElement("input");
		document.body.appendChild(input);
		const suggest = new GenericTextSuggester(createApp(), input, ["alpha", "beta"]);
		input.focus();
		await suggest.onInputChanged();
		expect(Array.from(document.querySelectorAll(".suggestion-item"), (row) => row.textContent)).toEqual(["alpha", "beta"]);

		// Typed, but the list has not followed yet: its refresh is still pending.
		input.value = "bet";
		const scope = (suggest as unknown as { scope: { trigger: (key: string) => unknown } }).scope;
		expect(scope.trigger("Enter")).toBe(false);

		await vi.waitFor(() => expect(input.value).toBe("beta"));
		expect(input.getAttribute("aria-expanded")).toBe("false");
		suggest.destroy();
	});
});
