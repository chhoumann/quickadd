import { describe, expect, it } from "vitest";
import {
	isPeekPromptShortcut,
	isSkipPromptShortcut,
	peekReturnHint,
	peekShortcutTooltip,
} from "./promptShortcuts";

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

describe("isPeekPromptShortcut", () => {
	it("matches ctrl/cmd+shift+E in either case", () => {
		expect(
			isPeekPromptShortcut(keyEvent({ shiftKey: true, ctrlKey: true })),
		).toBe(true);
		expect(
			isPeekPromptShortcut(
				keyEvent({ key: "E", shiftKey: true, metaKey: true }),
			),
		).toBe(true);
	});

	it("does not steal skip or submit", () => {
		expect(
			isPeekPromptShortcut(
				keyEvent({ key: "Enter", shiftKey: true, ctrlKey: true }),
			),
		).toBe(false);
		expect(isPeekPromptShortcut(keyEvent({ ctrlKey: true }))).toBe(false);
		expect(
			isSkipPromptShortcut(
				keyEvent({ key: "Enter", shiftKey: true, ctrlKey: true }),
			),
		).toBe(true);
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
	it("shows the chord only where a keyboard is expected", () => {
		expect(peekShortcutTooltip(true)).toContain("Ctrl/Cmd+Shift+E");
		expect(peekShortcutTooltip(false)).toBe(
			"Look at the note without losing this draft.",
		);
		expect(peekReturnHint()).toBe("Ctrl/Cmd+Shift+E returns to the prompt");
	});
});
