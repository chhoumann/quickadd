import { afterAll, beforeAll, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import { MacroChoice } from "../../src/types/choices/MacroChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { clickWhenStill, insertText, jsLiteral, POLL_OPTS, quickCommandBarOverflow, waitForElement } from "./uiHelpers";
import { withStoredChoices } from "./storedChoices";

// A choice's settings page on a phone: Obsidian's phone settings, where the
// page fills the screen under a header with the page's title and a back button
// that returns to the QuickAdd tab, then to the list of tabs.
const getContext = createQuickAddE2EHarness("choice-builder-pages-phone");

const KEYBOARD = 345;
let size: number[] = [];

/**
 * Switch mobile emulation, which reloads the app, and wait for QuickAdd to be
 * back. Plugins enabled for this session only (run-e2e enables Templater that
 * way) are gone after a reload, so enable them again.
 */
async function emulateMobile(on: boolean) {
	const { obsidian } = getContext();
	const enabled = await obsidian.dev.evalJson<string[]>("Object.keys(app.plugins.plugins)");
	await obsidian.execText("dev:mobile", on ? { on: true } : { off: true });
	await obsidian.waitFor(() => obsidian.dev.evalJson<boolean>(
		`document.body.classList.contains("is-mobile") === ${on} && Boolean(app.plugins.plugins.quickadd?.api)`,
	).catch(() => false), { message: `mobile emulation ${on ? "on" : "off"}`, timeoutMs: 30_000, intervalMs: 500 });
	await obsidian.dev.evalJsonAsync(`(async () => {
		for (const id of ${jsLiteral(enabled)}) {
			if (!app.plugins.plugins[id]) await app.plugins.enablePlugin(id);
		}
		return true;
	})()`);
}

beforeAll(async () => {
	const { obsidian } = getContext();
	size = await obsidian.dev.evalJson<number[]>("electronWindow.getSize()");
	// Mobile emulation reloads the app, so it is switched once for the file.
	await emulateMobile(true);
	await obsidian.dev.evalJson("electronWindow.setMinimumSize(200, 200), electronWindow.setSize(390, 844), true");
	await obsidian.waitFor(() => obsidian.dev.evalJson<boolean>(
		'innerWidth === 390 && document.body.classList.contains("is-phone")',
	), { message: "a 390px phone window", timeoutMs: 10_000 });
}, 60_000);

afterAll(async () => {
	const { obsidian } = getContext();
	await obsidian.dev.evalJson(`app.setting.close(), electronWindow.setSize(${size[0]}, ${size[1]}), true`);
	await emulateMobile(false);
}, 60_000);

async function openMacroPage() {
	await openChoicePage(new MacroChoice("Phone macro"));
	await waitForElement(getContext().obsidian, ".macroBuilder .qa-command-sequence-input");
}

async function openChoicePage(choice: IChoice) {
	const { obsidian, plugin } = getContext();
	await plugin.data<{ choices: IChoice[]; disableOnlineFeatures: boolean }>().patch(withStoredChoices((data) => {
		data.choices = [choice];
		// AI on adds the AI Assistant button, the widest quick-command bar.
		data.disableOnlineFeatures = false;
	}));
	await plugin.reload({ waitUntilReady: true });
	// On a phone settings closes with an animation, and opening it before that
	// ends does nothing.
	await obsidian.dev.evalJson("app.setting.close(), true");
	await obsidian.waitFor(() => obsidian.dev.evalJson<boolean>(
		'!document.querySelector(".modal.mod-settings")',
	), { message: "settings closed", timeoutMs: 10_000 });
	await obsidian.dev.evalJson("app.setting.open(), app.setting.openTabById('quickadd'), true");
	// A phone row has no gear: its menu has Configure.
	await clickWhenStill(obsidian, `[aria-label=${jsLiteral(`More options for ${choice.name}`)}]`);
	await obsidian.waitFor(() => obsidian.dev.evalJson<boolean>(`(() => {
		const item = [...document.querySelectorAll(".menu-item")].find((el) => el.textContent.trim() === "Configure");
		item?.setAttribute("data-qa-configure", "");
		return Boolean(item);
	})()`), { message: "the row menu's Configure", timeoutMs: 10_000 });
	await clickWhenStill(obsidian, ".menu-item[data-qa-configure]");
	await expect.poll(
		() => obsidian.dev.evalJson<string[]>("app.setting.pageStack.map((entry) => entry.page.title)"),
		POLL_OPTS,
	).toEqual([choice.name]);
}

it("fits the page to the phone and goes back to the QuickAdd tab, then the tab list", async () => {
	const { obsidian } = getContext();
	try {
		await openMacroPage();

		// The settings header carries the page's title; nothing is wider than the screen.
		expect(await obsidian.dev.evalJson<string>(
			'document.querySelector(".modal.mod-settings .modal-header").textContent',
		)).toContain("Phone macro");
		expect(await obsidian.dev.evalJson<boolean>(`(() => {
			const page = document.querySelector(".macroBuilder");
			return page.scrollWidth <= page.clientWidth;
		})()`)).toBe(true);
		// The quick-command bar keeps its card's padding, with all six buttons
		// (AI is on) and no steps above it (#2145).
		expect(await quickCommandBarOverflow(obsidian)).toEqual([]);

		const header = () => obsidian.dev.evalJson<[number, string | null]>(
			"[app.setting.pageStack.length, app.setting.activeTab?.id ?? null]",
		);
		await obsidian.dev.evalJson("app.setting.onHistoryBack(), true");
		await expect.poll(header, POLL_OPTS).toEqual([0, "quickadd"]);
		await obsidian.dev.evalJson("app.setting.onHistoryBack(), true");
		await expect.poll(header, POLL_OPTS).toEqual([0, null]);
	} finally {
		await obsidian.dev.evalJson("app.setting.close(), true");
	}
});

it("keeps the focused field and its suggestions above the keyboard, under a header that stays solid", async () => {
	const { obsidian, sandbox } = getContext();
	try {
		// A script for the field to suggest.
		await seedVaultFile(obsidian, sandbox, "phoneScript.js", "module.exports = async () => {};\n");
		await openMacroPage();
		await obsidian.dev.evalJson(`(() => {
			document.documentElement.style.setProperty("--keyboard-height", "${KEYBOARD}px");
			const page = document.querySelector(".macroBuilder");
			page.scrollTop = 0;
			[...page.querySelectorAll("input")].find((input) => input.placeholder.startsWith("Start typing script")).focus({ preventScroll: true });
			window.dispatchEvent(new Event("keyboardDidShow"));
			return true;
		})()`);

		const placement = await obsidian.dev.evalJson<{ fieldBottom: number; keyboardTop: number; headerMask: string }>(`(() => {
			const field = document.activeElement;
			const header = document.querySelector(".modal.mod-settings .modal-header");
			return {
				fieldBottom: field.getBoundingClientRect().bottom,
				keyboardTop: innerHeight - ${KEYBOARD},
				headerMask: getComputedStyle(header, "::after").maskImage,
			};
		})()`);
		expect(placement.fieldBottom).toBeLessThanOrEqual(placement.keyboardTop);
		// Obsidian's header fades out from 20% of its background's height; over
		// a builder page it stays solid through the header (77% of 130%).
		expect(placement.headerMask).toContain("77%");

		// The emulated keyboard does not shrink the visual viewport, as on
		// Android, so the list opens above the field, not under the keyboard.
		await insertText(obsidian, "phoneScript");
		await waitForElement(obsidian, ".suggestion-container .suggestion-item");
		expect(await obsidian.dev.evalJson<boolean>(`(() => {
			const list = document.querySelector(".suggestion-container").getBoundingClientRect();
			return list.bottom <= document.activeElement.getBoundingClientRect().top;
		})()`)).toBe(true);
	} finally {
		await obsidian.dev.evalJson(
			'document.documentElement.style.removeProperty("--keyboard-height"), app.setting.close(), true',
		);
	}
});

it("keeps a field's suggestions under the settings header, with its back and close buttons", async () => {
	const { obsidian } = getContext();
	try {
		await openMacroPage();
		// The Obsidian command field a little under the header, with the keyboard
		// up: its list has room neither above nor below for all 240px of it.
		await obsidian.dev.evalJson(`(() => {
			document.documentElement.style.setProperty("--keyboard-height", "${KEYBOARD}px");
			const page = document.querySelector(".qa-builder-page");
			const header = document.querySelector(".modal.mod-settings .modal-header").getBoundingClientRect();
			const field = [...page.querySelectorAll("input")].find((input) => input.placeholder === "Obsidian command");
			page.scrollTop += field.getBoundingClientRect().top - (header.bottom + 180);
			field.focus({ preventScroll: true });
			window.dispatchEvent(new Event("keyboardDidShow"));
			return true;
		})()`);
		await waitForElement(obsidian, ".suggestion-container .suggestion-item");

		expect(await obsidian.dev.evalJson<Record<string, unknown>>(`(() => {
			const list = document.querySelector(".suggestion-container").getBoundingClientRect();
			const field = document.activeElement.getBoundingClientRect();
			const header = document.querySelector(".modal.mod-settings .modal-header").getBoundingClientRect();
			const onTop = (selector) => {
				const rect = document.querySelector(".modal.mod-settings " + selector).getBoundingClientRect();
				return Boolean(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest(selector));
			};
			return {
				underHeader: list.top >= header.bottom,
				aboveKeyboard: list.bottom <= innerHeight - ${KEYBOARD},
				offField: list.bottom <= field.top || list.top >= field.bottom,
				back: onTop(".modal-setting-back-button"),
				close: onTop(".modal-header-button"),
			};
		})()`)).toEqual({ underHeader: true, aboveKeyboard: true, offField: true, back: true, close: true });
	} finally {
		await obsidian.dev.evalJson(
			'document.documentElement.style.removeProperty("--keyboard-height"), app.setting.close(), true',
		);
	}
});

it("lines up the toggles on the right edge of their card (#2146)", async () => {
	const { obsidian } = getContext();
	try {
		await openChoicePage(new CaptureChoice("Phone capture"));
		// Rows whose only control is a toggle, with the toggle short of the edge.
		expect(await obsidian.dev.evalJson<string[]>(`(() => {
			const page = document.querySelector(".qa-builder-page");
			return [...page.querySelectorAll(".setting-item")].flatMap((row) => {
				const toggle = row.querySelector(":scope > .setting-item-control > .checkbox-container:only-child");
				if (!toggle) return [];
				const edge = row.getBoundingClientRect().right - parseFloat(getComputedStyle(row).paddingRight);
				const short = edge - toggle.getBoundingClientRect().right;
				return short > 0.5 ? [row.querySelector(".setting-item-name").textContent + ": " + Math.round(short) + "px"] : [];
			});
		})()`)).toEqual([]);
	} finally {
		await obsidian.dev.evalJson("app.setting.close(), true");
	}
});
