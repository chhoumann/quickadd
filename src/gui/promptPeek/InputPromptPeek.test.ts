import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Platform, Scope } from "obsidian";
import { InputPromptPeek, PEEK_HIDDEN_CLASS } from "./InputPromptPeek";
import type { InputPromptPeekHost } from "./InputPromptPeek";
import { PromptPeekSession } from "./PromptPeekSession";
import { clearVisiblePrompts } from "./visiblePrompts";

function makeHost(
	overrides: Partial<InputPromptPeekHost> & {
		field?: HTMLInputElement;
		selection?: string;
	} = {},
): InputPromptPeekHost & {
	field: HTMLInputElement;
	closed: boolean;
	pushScope: ReturnType<typeof vi.fn>;
	popScope: ReturnType<typeof vi.fn>;
} {
	const field = overrides.field ?? document.createElement("input");
	document.body.appendChild(field);
	const pushScope = vi.fn();
	const popScope = vi.fn();
	const state = { closed: false, value: field.value };
	const selection = overrides.selection ?? "";
	const host = {
		app: {
			workspace: {
				containerEl: document.body,
				getActiveViewOfType: () =>
					selection
						? { editor: { getSelection: () => selection } }
						: undefined,
			},
			keymap: { pushScope, popScope },
		} as unknown as InputPromptPeekHost["app"],
		title: "Capture text",
		containerEl: document.createElement("div"),
		scope: new Scope() as InputPromptPeekHost["scope"],
		getField: () => field,
		getValue: () => state.value,
		setValue: (value: string) => {
			state.value = value;
		},
		markDraftChanged: () => {},
		persistDraft: () => {},
		close: () => {
			state.closed = true;
		},
		...overrides,
	};
	document.body.appendChild(host.containerEl);
	return Object.defineProperties(host, {
		field: { get: () => field },
		closed: { get: () => state.closed },
		pushScope: { value: pushScope },
		popScope: { value: popScope },
	}) as InputPromptPeekHost & {
		field: HTMLInputElement;
		closed: boolean;
		pushScope: ReturnType<typeof vi.fn>;
		popScope: ReturnType<typeof vi.fn>;
	};
}

beforeEach(() => {
	document.body.replaceChildren();
});

afterEach(() => {
	PromptPeekSession.discard();
	clearVisiblePrompts();
	document.body.replaceChildren();
});

describe("InputPromptPeek", () => {
	it("hides the prompt without settling, then resumes with the field intact", () => {
		const field = document.createElement("input");
		field.value = "half written";
		const host = makeHost({ field });
		field.setSelectionRange(4, 4);
		const peek = new InputPromptPeek(host);

		peek.peek();

		expect(host.containerEl.classList.contains(PEEK_HIDDEN_CLASS)).toBe(true);
		expect(host.popScope).toHaveBeenCalledWith(host.scope);
		expect(host.closed).toBe(false);
		expect(PromptPeekSession.isPeeking()).toBe(true);
		const chip = document.querySelector(".qa-peek-chip");
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

		expect(host.containerEl.classList.contains(PEEK_HIDDEN_CLASS)).toBe(false);
		expect(host.pushScope).toHaveBeenCalledWith(host.scope);
		expect(host.field.value).toBe("half written");
		expect(host.field.selectionStart).toBe(4);
		expect(document.activeElement).toBe(host.field);
		expect(PromptPeekSession.isPeeking()).toBe(false);
		expect(document.querySelector(".qa-peek-chip")).toBeNull();
	});

	it("inserts the selection over the field's own selection range", () => {
		const field = document.createElement("input");
		field.value = "Note: ";
		const host = makeHost({ field, selection: "grabbed line" });
		field.setSelectionRange(6, 6);
		const peek = new InputPromptPeek(host);
		peek.peek();

		PromptPeekSession.getActive()?.insertSelectionAndResume();

		expect(host.getValue()).toBe("Note: grabbed line");
		expect(host.field.selectionStart).toBe("Note: grabbed line".length);
		expect(PromptPeekSession.isPeeking()).toBe(false);
	});

	it("replaces a select-all draft instead of prepending", () => {
		const field = document.createElement("input");
		field.value = "old draft";
		const host = makeHost({ field, selection: "fresh" });
		field.setSelectionRange(0, field.value.length);
		const peek = new InputPromptPeek(host);
		peek.peek();

		PromptPeekSession.getActive()?.insertSelectionAndResume();

		expect(host.getValue()).toBe("fresh");
	});

	it("cancel from the chip really closes the host", () => {
		const host = makeHost();
		const peek = new InputPromptPeek(host);
		peek.peek();
		PromptPeekSession.getActive()?.cancel();
		expect(host.closed).toBe(true);
		expect(PromptPeekSession.isPeeking()).toBe(false);
	});

	it("drops the chip when the host is closed from outside mid-peek", () => {
		const host = makeHost();
		const peek = new InputPromptPeek(host);
		peek.peek();
		expect(PromptPeekSession.isPeeking()).toBe(true);

		peek.onHostClosed();

		expect(PromptPeekSession.isPeeking()).toBe(false);
		expect(document.querySelector(".qa-peek-chip")).toBeNull();
	});

	it("peeking a second prompt cancels the parked first run", () => {
		const hostA = makeHost();
		const peekA = new InputPromptPeek(hostA);
		peekA.peek();

		const hostB = makeHost();
		const peekB = new InputPromptPeek(hostB);
		peekB.peek();

		expect(hostA.closed).toBe(true);
		expect(hostB.closed).toBe(false);
		expect(document.querySelectorAll(".qa-peek-chip")).toHaveLength(1);
		expect(PromptPeekSession.isPeeking()).toBe(true);
	});

	it("refuses to resume while another prompt is visible", () => {
		const hostA = makeHost();
		const peekA = new InputPromptPeek(hostA);
		peekA.peek();

		const hostB = makeHost();
		const peekB = new InputPromptPeek(hostB);
		peekB.onHostOpened();

		PromptPeekSession.getActive()?.resume();
		expect(PromptPeekSession.isPeeking()).toBe(true);
		expect(hostA.containerEl.classList.contains(PEEK_HIDDEN_CLASS)).toBe(true);

		peekB.onHostClosed();
		PromptPeekSession.getActive()?.resume();
		expect(PromptPeekSession.isPeeking()).toBe(false);
		expect(hostA.containerEl.classList.contains(PEEK_HIDDEN_CLASS)).toBe(false);
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
		expect(host.containerEl.classList.contains(PEEK_HIDDEN_CLASS)).toBe(false);
	});

	it("mounts a one-row compact chip on a phone", () => {
		const platform = Platform as unknown as {
			isPhone: boolean;
			isMobile: boolean;
		};
		const original = { phone: platform.isPhone, mobile: platform.isMobile };
		platform.isPhone = true;
		platform.isMobile = true;
		try {
			const peek = new InputPromptPeek(makeHost());
			peek.peek();
			const chip = document.querySelector(".qa-peek-chip");
			expect(chip?.classList.contains("qa-peek-chip--compact")).toBe(true);
			expect(chip?.classList.contains("qa-peek-chip--top")).toBe(true);
			expect(chip?.querySelector(".qa-peek-chip-hint")).toBeNull();
			expect(chip?.querySelector(".qa-peek-chip-subtitle")).toBeNull();
			expect(chip?.querySelector(".qa-peek-chip-keys")).toBeNull();
			expect(chip?.textContent).toContain("Capture text");
			expect(chip?.textContent).not.toContain("QuickAdd is waiting");
			expect(chip?.textContent).not.toContain("Ctrl/Cmd");
			expect(
				Array.from(chip?.querySelectorAll("button") ?? []).map(
					(button) => button.textContent,
				),
			).toEqual(expect.arrayContaining(["Insert", "Return"]));
			expect(
				chip?.querySelector(".qa-peek-chip-cancel [data-icon='x']"),
			).not.toBeNull();
		} finally {
			platform.isPhone = original.phone;
			platform.isMobile = original.mobile;
		}
	});
});
