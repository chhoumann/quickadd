import type { App } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Track Popper instances so we can assert that the existing one is reused
// (update) rather than recreated — and leaked — on every keystroke.
const { createPopperMock, popperInstances } = vi.hoisted(() => {
	type Options = { placement: string };
	const popperInstances: Array<{
		destroy: ReturnType<typeof vi.fn>;
		update: ReturnType<typeof vi.fn>;
		setOptions: ReturnType<typeof vi.fn>;
		state: { options: Options };
	}> = [];
	const createPopperMock = vi.fn((_reference: Element, _popper: HTMLElement, options: Options) => {
		const state = { options: { placement: options.placement } };
		const instance = {
			destroy: vi.fn(),
			update: vi.fn(),
			setOptions: vi.fn((next: Partial<Options>) => {
				state.options = { ...state.options, ...next };
			}),
			state,
		};
		popperInstances.push(instance);
		return instance;
	});
	return { createPopperMock, popperInstances };
});

vi.mock("@popperjs/core", () => ({
	createPopper: createPopperMock,
}));

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

	beforeEach(() => {
		createPopperMock.mockClear();
		popperInstances.length = 0;
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

	it("reuses a single Popper across keystrokes instead of leaking one per keystroke", async () => {
		const suggest = new GenericTextSuggester(app, input, ["abcde", "abcxyz"]);

		// First keystroke opens the dropdown and creates the Popper.
		input.value = "a";
		await suggest.onInputChanged();
		expect(createPopperMock).toHaveBeenCalledTimes(1);

		// Subsequent keystrokes re-open while already open. The Popper must be
		// reused (update) rather than recreated, otherwise an instance — and the
		// scroll/resize listeners it attaches — leaks on every keystroke.
		input.value = "ab";
		await suggest.onInputChanged();
		input.value = "abc";
		await suggest.onInputChanged();

		expect(createPopperMock).toHaveBeenCalledTimes(1);
		expect(popperInstances[0].update).toHaveBeenCalled();
		expect(popperInstances[0].destroy).not.toHaveBeenCalled();

		// Closing destroys the Popper; the next open creates a fresh one.
		suggest.close();
		expect(popperInstances[0].destroy).toHaveBeenCalledTimes(1);

		input.value = "abcd";
		await suggest.onInputChanged();
		expect(createPopperMock).toHaveBeenCalledTimes(2);
	});

	it("keeps the instance registered after close() so a later same-class suggester destroys it", async () => {
		const destroySpy = vi.spyOn(GenericTextSuggester.prototype, "destroy");

		const first = new GenericTextSuggester(app, input, ["abcde"]);
		input.value = "a";
		await first.onInputChanged();
		// Confirm it actually opened (close() early-returns when never opened,
		// which would skip the historically-buggy unregister path).
		expect(createPopperMock).toHaveBeenCalledTimes(1);

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

		expect(createPopperMock).not.toHaveBeenCalled();
	});

	it("does not reopen a note field hidden while its lookup was pending", async () => {
		const suggest = new DeferredSuggest(app, input);
		input.value = "a";
		const inFlight = suggest.onInputChanged();
		input.hidden = true;
		suggest.resolvePending?.(["a", "ab"]);
		await inFlight;
		expect(app.keymap.pushScope).not.toHaveBeenCalled();
		expect(createPopperMock).not.toHaveBeenCalled();
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
		expect(createPopperMock).not.toHaveBeenCalled();
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

		expect(createPopperMock).not.toHaveBeenCalled();
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
	// prompt's action bar in viewport pixels, and the height the list renders at.
	let input: HTMLInputElement;
	let actions: HTMLElement;
	let geometry: { input: [top: number, bottom: number]; actionsTop: number; listHeight: number };

	const box = (top: number, bottom: number) =>
		({ top, bottom, height: bottom - top, left: 0, right: 300, width: 300, x: 0, y: top }) as DOMRect;

	beforeEach(() => {
		createPopperMock.mockClear();
		popperInstances.length = 0;
		const modal = document.createElement("div");
		modal.className = "modal";
		input = document.createElement("input");
		actions = document.createElement("div");
		actions.className = "qa-prompt-actions";
		modal.append(input, actions);
		document.body.appendChild(modal);
		input.focus();
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
			if (this === input) return box(...geometry.input);
			if (this === actions) return box(geometry.actionsTop, geometry.actionsTop + 30);
			if (this.classList.contains("suggestion-container")) return box(0, geometry.listHeight);
			return box(0, 0);
		});
	});

	afterEach(() => {
		document.body.replaceChildren();
		vi.restoreAllMocks();
	});

	async function openedPlacement(): Promise<string> {
		const suggest = new GenericTextSuggester(createApp(), input, ["Lead"]);
		input.value = "Le";
		await suggest.onInputChanged();
		return createPopperMock.mock.calls[0][2].placement;
	}

	// Input 484-514, action bar from 546: 32px below the input, 4px of it the gap.
	it.each([
		[28, "bottom-start"], // ends at 546, touching but not covering the bar
		[29, "top-start"], // would cover the bar's top pixel
		[180, "top-start"],
	])("opens a %ipx list below the last input only when it clears the action bar", async (listHeight, expected) => {
		geometry = { input: [484, 514], actionsTop: 546, listHeight };
		expect(await openedPlacement()).toBe(expected);
	});

	it("stays below when there is no room above either", async () => {
		// Opening above would need 4 + 47 = 51px over the input; only 40px exist.
		geometry = { input: [40, 70], actionsTop: 102, listHeight: 47 };
		expect(await openedPlacement()).toBe("bottom-start");
	});

	it("ignores inputs outside a prompt with an action bar", async () => {
		actions.remove();
		geometry = { input: [484, 514], actionsTop: 546, listHeight: 47 };
		expect(await openedPlacement()).toBe("bottom-start");
	});

	it("re-decides on each refresh as the list's height changes", async () => {
		geometry = { input: [484, 514], actionsTop: 546, listHeight: 47 };
		const suggest = new GenericTextSuggester(createApp(), input, ["Lead", "Lean"]);
		input.value = "Le";
		await suggest.onInputChanged();
		const popper = popperInstances[0];
		expect(popper.state.options.placement).toBe("top-start");

		geometry.listHeight = 20;
		await suggest.onInputChanged();
		expect(popper.setOptions).toHaveBeenLastCalledWith({ placement: "bottom-start" });

		await suggest.onInputChanged();
		expect(popper.setOptions).toHaveBeenCalledTimes(1);
		expect(popper.update).toHaveBeenCalledTimes(1);
		expect(createPopperMock).toHaveBeenCalledTimes(1);
	});

	it("re-places the list when a multi-select pick refreshes it in place", async () => {
		// A filtered list fits below; after the pick the input is cleared and the
		// unfiltered list that stays open would reach the action bar.
		geometry = { input: [484, 514], actionsTop: 560, listHeight: 30 };
		const suggest = new GenericTextSuggester(createApp(), input, ["Ann", "Bob"]);
		input.value = "Ann";
		await suggest.onInputChanged();
		const popper = popperInstances[0];
		expect(popper.state.options.placement).toBe("bottom-start");

		const keepOpenRefresh = () => {
			input.value = "";
			return suggest.onInputChanged(
				Object.assign(new Event("input"), { fromCompletion: true, keepOpen: true }),
			);
		};
		geometry.listHeight = 90;
		await keepOpenRefresh();
		expect(popper.setOptions).toHaveBeenCalledWith({ placement: "top-start" });

		// Same placement, but the input may have moved (a new chip row).
		await keepOpenRefresh();
		expect(popper.update).toHaveBeenCalledTimes(1);
		expect(createPopperMock).toHaveBeenCalledTimes(1);
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
