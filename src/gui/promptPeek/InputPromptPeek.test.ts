import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InputPromptPeek } from "./InputPromptPeek";
import type { InputPromptPeekHost } from "./InputPromptPeek";
import { PromptPeekSession } from "./PromptPeekSession";

function makeHost(
	overrides: Partial<InputPromptPeekHost> & { field?: HTMLInputElement } = {},
): InputPromptPeekHost & {
	closed: boolean;
	cancelled: boolean;
	remounts: number;
} {
	const field = overrides.field ?? document.createElement("input");
	const state = {
		closed: false,
		cancelled: false,
		remounts: 0,
		value: field.value,
	};
	const host: InputPromptPeekHost & {
		closed: boolean;
		cancelled: boolean;
		remounts: number;
	} = {
		app: {
			workspace: {
				containerEl: document.body,
				getActiveViewOfType: () => undefined,
			},
			keymap: { pushScope: () => {}, popScope: () => {} },
		} as unknown as InputPromptPeekHost["app"],
		title: "Capture text",
		getField: () => field,
		getValue: () => state.value,
		setValue: (value) => {
			state.value = value;
			field.value = value;
		},
		markDraftChanged: () => {},
		persistDraft: () => {},
		remount: () => {
			state.remounts += 1;
		},
		close: () => {
			state.closed = true;
		},
		settleCancel: () => {
			state.cancelled = true;
		},
		closed: false,
		cancelled: false,
		remounts: 0,
		...overrides,
	};
	Object.defineProperties(host, {
		closed: { get: () => state.closed },
		cancelled: { get: () => state.cancelled },
		remounts: { get: () => state.remounts },
	});
	return host;
}

const originalInnerWidth = window.innerWidth;

beforeEach(() => {
	Object.defineProperty(window, "innerWidth", {
		configurable: true,
		value: 1280,
	});
});

afterEach(() => {
	PromptPeekSession.discard();
	document.querySelector(".qa-peek-chip")?.remove();
	Object.defineProperty(window, "innerWidth", {
		configurable: true,
		value: originalInnerWidth,
	});
});

describe("InputPromptPeek", () => {
	it("hides the prompt without settling, then resumes", () => {
		const field = document.createElement("input");
		field.value = "half written";
		field.selectionStart = 4;
		field.selectionEnd = 4;
		const host = makeHost({ field });
		const peek = new InputPromptPeek(host);

		peek.peek();

		expect(host.closed).toBe(true);
		expect(peek.shouldSettleOnClose()).toBe(false);
		expect(PromptPeekSession.isPeeking()).toBe(true);
		const chip = document.querySelector(".qa-peek-chip");
		expect(chip?.classList.contains("qa-peek-chip--top")).toBe(false);
		expect(chip?.textContent).toContain("QuickAdd is waiting");
		expect(chip?.textContent).toContain("Capture text");
		expect(
			Array.from(chip?.querySelectorAll("button") ?? []).map(
				(button) => button.textContent,
			),
		).toEqual(
			expect.arrayContaining(["Insert selection", "Return", "Cancel"]),
		);

		PromptPeekSession.getActive()?.resume();

		expect(host.remounts).toBe(1);
		expect(peek.shouldSettleOnClose()).toBe(true);
		expect(PromptPeekSession.isPeeking()).toBe(false);
		expect(document.querySelector(".qa-peek-chip")).toBeNull();
	});

	it("inserts the selection at the caret and remounts", () => {
		const field = document.createElement("input");
		field.value = "Note: ";
		field.selectionStart = 6;
		field.selectionEnd = 6;
		const view = { editor: { getSelection: () => "grabbed line" } };
		const host = makeHost({
			field,
			app: {
				workspace: {
					containerEl: document.body,
					getActiveViewOfType: () => view,
				},
				keymap: { pushScope: () => {}, popScope: () => {} },
			} as unknown as InputPromptPeekHost["app"],
		});
		const peek = new InputPromptPeek(host);
		peek.peek();
		expect(document.querySelector(".qa-peek-chip")).not.toBeNull();

		PromptPeekSession.getActive()?.insertSelectionAndResume();

		expect(host.getValue()).toBe("Note: grabbed line");
		expect(host.remounts).toBe(1);
		expect(PromptPeekSession.isPeeking()).toBe(false);
	});

	it("cancel from the chip settles the run", () => {
		const host = makeHost();
		const peek = new InputPromptPeek(host);
		peek.peek();
		PromptPeekSession.getActive()?.cancel();
		expect(host.cancelled).toBe(true);
		expect(peek.shouldSettleOnClose()).toBe(true);
		expect(PromptPeekSession.isPeeking()).toBe(false);
	});

	it("leaves Escape in the editor for Vim", () => {
		const host = makeHost();
		const peek = new InputPromptPeek(host);
		peek.peek();
		const chip = document.querySelector(".qa-peek-chip");
		expect(chip?.textContent).not.toContain("Esc returns");

		document.body.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
		expect(PromptPeekSession.isPeeking()).toBe(true);
		expect(host.remounts).toBe(0);
	});

	it("returns when Escape is pressed on the chip itself", () => {
		const host = makeHost();
		const peek = new InputPromptPeek(host);
		peek.peek();
		const chip = document.querySelector(".qa-peek-chip");
		chip?.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
		expect(PromptPeekSession.isPeeking()).toBe(false);
		expect(host.remounts).toBe(1);
	});

	it("mounts a one-row compact chip on a phone-width window", () => {
		const originalWidth = window.innerWidth;
		Object.defineProperty(window, "innerWidth", {
			configurable: true,
			value: 390,
		});
		try {
			const peek = new InputPromptPeek(makeHost());
			peek.peek();
			const chip = document.querySelector(".qa-peek-chip");
			expect(chip?.classList.contains("qa-peek-chip--compact")).toBe(true);
			expect(chip?.classList.contains("qa-peek-chip--top")).toBe(true);
			expect(chip?.querySelector(".qa-peek-chip-hint")).toBeNull();
			expect(chip?.querySelector(".qa-peek-chip-subtitle")).toBeNull();
			expect(chip?.textContent).toContain("Capture text");
			expect(chip?.textContent).not.toContain("QuickAdd is waiting");
			expect(chip?.textContent).not.toContain("Ctrl/Cmd");
			expect(
				Array.from(chip?.querySelectorAll("button") ?? []).map(
					(button) => button.textContent,
				),
			).toEqual(expect.arrayContaining(["Insert", "Return"]));
			expect(chip?.querySelector(".qa-peek-chip-cancel [data-icon='x']")).not.toBeNull();
		} finally {
			Object.defineProperty(window, "innerWidth", {
				configurable: true,
				value: originalWidth,
			});
		}
	});
});
