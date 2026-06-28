import type { App } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Track Popper instances so we can assert that the existing one is reused
// (update) rather than recreated — and leaked — on every keystroke.
const { createPopperMock, popperInstances } = vi.hoisted(() => {
	const popperInstances: Array<{
		destroy: ReturnType<typeof vi.fn>;
		update: ReturnType<typeof vi.fn>;
	}> = [];
	const createPopperMock = vi.fn(() => {
		const instance = { destroy: vi.fn(), update: vi.fn() };
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

	it("ignores onInputChanged fired after destroy() (pending debounce)", async () => {
		const suggest = new GenericTextSuggester(app, input, ["abcde"]);

		suggest.destroy();
		input.value = "a";
		await suggest.onInputChanged();

		expect(createPopperMock).not.toHaveBeenCalled();
	});
});
