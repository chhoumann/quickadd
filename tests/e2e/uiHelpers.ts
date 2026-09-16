import { expect } from "vitest";
import type { ObsidianClient } from "obsidian-e2e";

export const POLL_OPTS = { timeout: 10_000, interval: 200 };

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

export async function expectNoPrompt(obsidian: ObsidianClient) {
	await expect.poll(() => obsidian.dev.evalJson<boolean>(
		'Boolean(document.querySelector(".modal-container, .prompt"))',
	), POLL_OPTS).toBe(false);
}

