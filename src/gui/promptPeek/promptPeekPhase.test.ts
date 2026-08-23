import { describe, expect, it } from "vitest";
import {
	beginPeek,
	canPeek,
	insertAtCursor,
	isPeekPromptShortcut,
	peekReturnHint,
	peekShortcutTooltip,
	previewSelection,
	resumePeek,
	settlePeek,
	shouldSettleOnClose,
} from "./promptPeekPhase";

function keyEvent(
	parts: Partial<
		Pick<
			KeyboardEvent,
			"key" | "shiftKey" | "ctrlKey" | "metaKey" | "isComposing"
		>
	>,
): KeyboardEvent {
	return {
		key: "e",
		shiftKey: false,
		ctrlKey: false,
		metaKey: false,
		isComposing: false,
		...parts,
	} as KeyboardEvent;
}

describe("prompt peek phase", () => {
	it("only peeks from an open prompt", () => {
		expect(canPeek({ kind: "open" })).toBe(true);
		expect(canPeek({ kind: "peeking" })).toBe(false);
		expect(canPeek({ kind: "settled", outcome: "cancelled" })).toBe(false);
	});

	it("close during peek does not settle the run", () => {
		const peeking = beginPeek({ kind: "open" });
		expect(peeking).toEqual({ kind: "peeking" });
		expect(shouldSettleOnClose(peeking)).toBe(false);
		expect(shouldSettleOnClose({ kind: "open" })).toBe(true);
	});

	it("resume returns to open, cancel settles", () => {
		const peeking = beginPeek({ kind: "open" });
		expect(resumePeek(peeking)).toEqual({ kind: "open" });
		expect(settlePeek(peeking, "cancelled")).toEqual({
			kind: "settled",
			outcome: "cancelled",
		});
	});

	it("ignores peek/resume once settled", () => {
		const settled = settlePeek({ kind: "open" }, "submitted");
		expect(beginPeek(settled)).toBe(settled);
		expect(resumePeek(settled)).toBe(settled);
	});
});

describe("insertAtCursor", () => {
	it("inserts at the caret and advances it", () => {
		expect(insertAtCursor("Hello ", 6, "world")).toEqual({
			text: "Hello world",
			cursor: 11,
		});
	});

	it("clamps a caret past the end", () => {
		expect(insertAtCursor("ab", 99, "c")).toEqual({
			text: "abc",
			cursor: 3,
		});
	});
});

describe("isPeekPromptShortcut", () => {
	it("matches ctrl/cmd+shift+E", () => {
		expect(
			isPeekPromptShortcut(keyEvent({ shiftKey: true, ctrlKey: true })),
		).toBe(true);
		expect(
			isPeekPromptShortcut(keyEvent({ shiftKey: true, metaKey: true })),
		).toBe(true);
	});

	it("does not steal skip or submit", () => {
		expect(
			isPeekPromptShortcut(
				keyEvent({ key: "Enter", shiftKey: true, ctrlKey: true }),
			),
		).toBe(false);
		expect(isPeekPromptShortcut(keyEvent({ ctrlKey: true }))).toBe(false);
	});

	it("ignores IME composition", () => {
		expect(
			isPeekPromptShortcut(
				keyEvent({ shiftKey: true, ctrlKey: true, isComposing: true }),
			),
		).toBe(false);
	});
});

describe("peek shortcut copy", () => {
	it("keeps keyboard hints off the phone", () => {
		expect(peekReturnHint(true)).toBeNull();
		expect(peekShortcutTooltip(true)).toBe(
			"Look at the note without losing this draft.",
		);
		expect(peekReturnHint(false)).toBe(
			"Ctrl/Cmd+Shift+E returns to the prompt",
		);
	});
});

describe("previewSelection", () => {
	it("collapses whitespace and ellipsizes", () => {
		expect(previewSelection("alpha   beta\ngamma", 11)).toBe("alpha beta…");
	});
});
