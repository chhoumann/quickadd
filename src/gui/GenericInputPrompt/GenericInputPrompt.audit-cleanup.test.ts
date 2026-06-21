import { describe, it, expect } from "vitest";
import { isSkipPromptShortcut } from "./GenericInputPrompt";

/**
 * Optional text/number/slider/wide-input prompts gained a keyboard skip
 * shortcut (ctrl/cmd+shift+Enter), mirroring the optional suggesters. This
 * locks the shortcut's exact key combo and — critically — proves it does NOT
 * collide with the wide prompt's ctrl/cmd+Enter submit (issue #1259).
 */

type KeyParts = Partial<{
	key: string;
	shiftKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	isComposing: boolean;
}>;

function keyEvent(parts: KeyParts): KeyboardEvent {
	return {
		key: "Enter",
		shiftKey: false,
		ctrlKey: false,
		metaKey: false,
		isComposing: false,
		...parts,
	} as KeyboardEvent;
}

describe("isSkipPromptShortcut", () => {
	it("matches ctrl+shift+Enter", () => {
		expect(
			isSkipPromptShortcut(keyEvent({ ctrlKey: true, shiftKey: true })),
		).toBe(true);
	});

	it("matches cmd+shift+Enter", () => {
		expect(
			isSkipPromptShortcut(keyEvent({ metaKey: true, shiftKey: true })),
		).toBe(true);
	});

	it("does not match plain Enter (the normal submit gesture)", () => {
		expect(isSkipPromptShortcut(keyEvent({}))).toBe(false);
	});

	it("does not match ctrl/cmd+Enter (the wide prompt submit gesture)", () => {
		// This is the load-bearing case: without the shift requirement the
		// shortcut would clobber the wide prompt's submit binding.
		expect(isSkipPromptShortcut(keyEvent({ ctrlKey: true }))).toBe(false);
		expect(isSkipPromptShortcut(keyEvent({ metaKey: true }))).toBe(false);
	});

	it("does not match shift+Enter alone (no modifier)", () => {
		expect(isSkipPromptShortcut(keyEvent({ shiftKey: true }))).toBe(false);
	});

	it("requires the Enter key", () => {
		expect(
			isSkipPromptShortcut(
				keyEvent({ key: "a", ctrlKey: true, shiftKey: true }),
			),
		).toBe(false);
	});

	it("ignores IME composition", () => {
		expect(
			isSkipPromptShortcut(
				keyEvent({ ctrlKey: true, shiftKey: true, isComposing: true }),
			),
		).toBe(false);
	});
});

/**
 * Re-derive the exact branching of each prompt's `submitEnterCallback` to prove
 * routing: skip fires before submit, and only on optional prompts. Keeping the
 * predicate first is what makes ctrl/cmd+shift+Enter skip (not submit) in the
 * wide prompt despite its ctrl/cmd+Enter submit binding.
 */
function route(
	evt: KeyboardEvent,
	isOptional: boolean,
	submitMatches: (e: KeyboardEvent) => boolean,
): "skip" | "submit" | "none" {
	if (isOptional && isSkipPromptShortcut(evt)) return "skip";
	if (submitMatches(evt)) return "submit";
	return "none";
}

// GenericInputPrompt / Number / Slider submit on plain Enter.
const genericSubmit = (e: KeyboardEvent) => !e.isComposing && e.key === "Enter";
// Wide prompt submits on ctrl/cmd+Enter.
const wideSubmit = (e: KeyboardEvent) =>
	(e.ctrlKey || e.metaKey) && e.key === "Enter";

describe("submitEnterCallback routing (generic/number/slider)", () => {
	it("ctrl/cmd+shift+Enter skips on optional prompts", () => {
		expect(
			route(keyEvent({ ctrlKey: true, shiftKey: true }), true, genericSubmit),
		).toBe("skip");
	});

	it("ctrl/cmd+shift+Enter does not skip on non-optional prompts", () => {
		// Falls through to plain-Enter submit (behavior unchanged for required).
		expect(
			route(keyEvent({ ctrlKey: true, shiftKey: true }), false, genericSubmit),
		).toBe("submit");
	});

	it("plain Enter still submits on optional prompts", () => {
		expect(route(keyEvent({}), true, genericSubmit)).toBe("submit");
	});
});

describe("submitEnterCallback routing (wide prompt, issue #1259 collision)", () => {
	it("ctrl/cmd+shift+Enter skips instead of submitting on optional prompts", () => {
		expect(
			route(keyEvent({ ctrlKey: true, shiftKey: true }), true, wideSubmit),
		).toBe("skip");
		expect(
			route(keyEvent({ metaKey: true, shiftKey: true }), true, wideSubmit),
		).toBe("skip");
	});

	it("ctrl/cmd+Enter still submits (submit binding preserved)", () => {
		expect(route(keyEvent({ ctrlKey: true }), true, wideSubmit)).toBe(
			"submit",
		);
		expect(route(keyEvent({ metaKey: true }), true, wideSubmit)).toBe(
			"submit",
		);
	});

	it("ctrl/cmd+shift+Enter submits on non-optional wide prompts (unchanged)", () => {
		expect(
			route(keyEvent({ ctrlKey: true, shiftKey: true }), false, wideSubmit),
		).toBe("submit");
	});
});
