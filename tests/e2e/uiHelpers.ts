import { expect } from "vitest";
import type { ObsidianClient } from "obsidian-e2e";

export const POLL_OPTS = { timeout: 10_000, interval: 200 };

const UNSAFE_IN_CODE: Record<string, string> = {
	"<": "\\u003C",
	">": "\\u003E",
	"/": "\\u002F",
	"\\": "\\\\",
	"\b": "\\b",
	"\f": "\\f",
	"\n": "\\n",
	"\r": "\\r",
	"\t": "\\t",
	"\0": "\\0",
	"\u2028": "\\u2028",
	"\u2029": "\\u2029",
};

/** A JavaScript literal for `value`, safe to splice into code run by `eval` (CodeQL js/bad-code-sanitization). */
export function jsLiteral(value: unknown): string {
	return JSON.stringify(value).replace(/[<>\b\f\n\r\t\0\u2028\u2029]/g, (char) => UNSAFE_IN_CODE[char]);
}

export async function waitForElement(obsidian: ObsidianClient, selector: string) {
	await expect.poll(() => obsidian.dev.evalJson<boolean>(
		`Boolean(document.querySelector(${JSON.stringify(selector)})?.getClientRects().length)`,
	), POLL_OPTS).toBe(true);
}

export async function typeInto(obsidian: ObsidianClient, selector: string, text: string) {
	expect(await obsidian.dev.evalJson<boolean>(`(() => {
		const input = document.querySelector(${JSON.stringify(selector)});
		if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return false;
		input.focus();
		input.select();
		return true;
	})()`)).toBe(true);
	await obsidian.exec("dev:cdp", {
		method: "Input.insertText",
		params: JSON.stringify({ text }),
	});
}

export async function pressKey(obsidian: ObsidianClient, key: "Enter" | "Escape" | "F8", modified = false) {
	const modifiers = modified
		? (await obsidian.dev.evalJson<string>("process.platform")) === "darwin" ? 4 : 2
		: 0;
	for (const type of ["keyDown", "keyUp"]) {
		await obsidian.exec("dev:cdp", {
			method: "Input.dispatchKeyEvent",
			params: JSON.stringify({ type, key, code: key, windowsVirtualKeyCode: { Enter: 13, Escape: 27, F8: 119 }[key], modifiers: modifiers | (modified && key === "F8" ? 8 : 0) }),
		});
	}
}

/**
 * A real left click at viewport coordinates. Unlike `element.click()`, it goes
 * through the browser's hit testing, so whatever is layered on top at that
 * point receives it.
 */
export async function clickAt(obsidian: ObsidianClient, x: number, y: number) {
	for (const type of ["mousePressed", "mouseReleased"]) {
		await obsidian.exec("dev:cdp", {
			method: "Input.dispatchMouseEvent",
			params: JSON.stringify({ type, x, y, button: "left", clickCount: 1 }),
		});
	}
}

export async function expectNoPrompt(obsidian: ObsidianClient) {
	await expect.poll(() => obsidian.dev.evalJson<boolean>(
		'Boolean(document.querySelector(".modal-container, .prompt"))',
	), POLL_OPTS).toBe(false);
}
