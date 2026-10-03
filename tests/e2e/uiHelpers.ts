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

/**
 * Page source for `describe(element)`, a short label such as
 * `button.mod-cta "Submit"`, for failure messages that name what is on top or
 * what has focus.
 */
export const DESCRIBE_ELEMENT = `const describe = (el) => {
	if (!el) return "nothing";
	const classes = Array.from(el.classList).slice(0, 2).map((name) => "." + name).join("");
	const text = (el.getAttribute("aria-label") || el.placeholder || el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 60);
	return el.tagName.toLowerCase() + classes + (text ? " " + JSON.stringify(text) : "");
};`;

const INPUT_TARGET = `(() => {
	${DESCRIBE_ELEMENT}
	return [
		"focus: " + describe(document.activeElement),
		document.hasFocus() ? "" : "document not focused",
		activeWindow === window ? "" : "activeWindow is another window",
		"modals: " + document.querySelectorAll(".modal-container").length,
	].filter(Boolean).join(", ");
})()`;

// Where each native input of the running test went, printed if it fails. See
// tests/e2e/setup.ts.
const inputLog: string[] = [];

export function takeInputLog(): string[] {
	return inputLog.splice(0);
}

/**
 * Sends native input through the Chrome DevTools Protocol. Obsidian answers a
 * failed CDP command with an "Error: ..." reply and a zero exit code, so check
 * for the JSON result rather than lose the input silently.
 */
async function sendInput(obsidian: ObsidianClient, label: string, target: string, commands: [string, object][]) {
	inputLog.push(`${label} -> ${await obsidian.dev.evalJson<string>(target)}`);
	for (const [method, params] of commands) {
		const reply = await obsidian.execText("dev:cdp", { method, params: JSON.stringify(params) });
		if (!reply.startsWith("{")) throw new Error(`dev:cdp ${method} failed: ${reply}`);
	}
}

/** Inserts text at the focused element, the way an IME commits it. */
export async function insertText(obsidian: ObsidianClient, text: string) {
	await sendInput(obsidian, `insertText ${JSON.stringify(text)}`, INPUT_TARGET, [["Input.insertText", { text }]]);
}

export async function typeInto(obsidian: ObsidianClient, selector: string, text: string) {
	expect(await obsidian.dev.evalJson<boolean>(`(() => {
		const input = document.querySelector(${JSON.stringify(selector)});
		if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return false;
		input.focus();
		input.select();
		return true;
	})()`)).toBe(true);
	await insertText(obsidian, text);
}

export async function pressKey(obsidian: ObsidianClient, key: "Enter" | "Escape" | "F8" | "Backspace" | "Tab", modified = false) {
	const modifiers = modified
		? (await obsidian.dev.evalJson<string>("process.platform")) === "darwin" ? 4 : 2
		: 0;
	const event = { key, code: key, windowsVirtualKeyCode: { Enter: 13, Escape: 27, F8: 119, Backspace: 8, Tab: 9 }[key], modifiers: modifiers | (modified && key === "F8" ? 8 : 0) };
	// A real Enter also types "\r", which is what makes a focused button click.
	const text = key === "Enter" && !modified ? { text: "\r" } : {};
	await sendInput(obsidian, `press ${modified ? "Mod+" : ""}${key}`, INPUT_TARGET, [
		["Input.dispatchKeyEvent", { type: "keyDown", ...event, ...text }],
		["Input.dispatchKeyEvent", { type: "keyUp", ...event }],
	]);
}

/**
 * A real left click at viewport coordinates. Unlike `element.click()`, it goes
 * through the browser's hit testing, so whatever is layered on top at that
 * point receives it.
 */
export async function clickAt(obsidian: ObsidianClient, x: number, y: number) {
	const target = `(() => { ${DESCRIBE_ELEMENT} return "on top: " + describe(document.elementFromPoint(${x}, ${y})); })()`;
	await sendInput(obsidian, `click (${Math.round(x)}, ${Math.round(y)})`, target, [
		["Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }],
		["Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }],
	]);
}

export async function expectNoPrompt(obsidian: ObsidianClient) {
	await expect.poll(() => obsidian.dev.evalJson<boolean>(
		'Boolean(document.querySelector(".modal-container, .prompt"))',
	), POLL_OPTS).toBe(false);
}

/**
 * A real click in the middle of the visible element matching `selector`, once
 * it stops moving: a settings page slides in when it opens or is returned to.
 */
export async function clickWhenStill(obsidian: ObsidianClient, selector: string) {
	let last = "";
	const point = await obsidian.waitFor(async () => {
		const rect = await obsidian.dev.evalJson<{ x: number; y: number } | null>(`(() => {
			const el = [...document.querySelectorAll(${jsLiteral(selector)})].find((el) => el.getClientRects().length > 0);
			if (!el) return null;
			el.scrollIntoView({ block: "nearest" });
			const rect = el.getBoundingClientRect();
			return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
		})()`);
		const key = JSON.stringify(rect);
		const settled = rect !== null && key === last;
		last = key;
		return settled ? rect : false;
	}, { message: `${selector} visible and still`, timeoutMs: 10_000, intervalMs: 100 });
	await clickAt(obsidian, point.x, point.y);
}

/**
 * Leave the settings page on top with a real click on its back button, as a
 * user does. Leaving a choice builder's page saves it.
 */
export async function leaveSettingsPage(obsidian: ObsidianClient) {
	const depth = await obsidian.dev.evalJson<number>("app.setting.pageStack.length");
	await clickWhenStill(obsidian, ".setting-page-back-button");
	await expect.poll(() => obsidian.dev.evalJson<number>("app.setting.pageStack.length"), POLL_OPTS).toBe(depth - 1);
}

/**
 * The buttons of the quick-command bar on the settings page on top that stray
 * into its card's padding, as "label: side", or none.
 */
export async function quickCommandBarOverflow(obsidian: ObsidianClient): Promise<string[]> {
	return obsidian.dev.evalJson<string[]>(`(() => {
		const bar = [...document.querySelectorAll(".qa-builder-page .quickCommandContainer")]
			.filter((el) => el.getClientRects().length > 0).pop();
		const card = bar.closest(".setting-items");
		const style = getComputedStyle(card);
		const padX = parseFloat(style.getPropertyValue("--setting-items-padding-x"));
		const padY = parseFloat(style.getPropertyValue("--setting-items-padding-y"));
		const box = card.getBoundingClientRect();
		return [...bar.children].flatMap((button) => {
			const rect = button.getBoundingClientRect();
			const label = button.getAttribute("aria-label");
			return [
				rect.top < box.top + padY - 0.5 ? label + ": top" : null,
				rect.left < box.left + padX - 0.5 ? label + ": left" : null,
				rect.right > box.right - padX + 0.5 ? label + ": right" : null,
			].filter(Boolean);
		});
	})()`);
}
