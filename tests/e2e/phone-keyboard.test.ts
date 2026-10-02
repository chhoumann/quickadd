import { afterEach, expect, it } from "vitest";
import { MacroChoice } from "../../src/types/choices/MacroChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness } from "./e2eVault";
import { jsLiteral, POLL_OPTS, waitForElement } from "./uiHelpers";

const getContext = createQuickAddE2EHarness("phone-keyboard");

// #2132: on a phone the keyboard covered the lower part of QuickAdd dialogs:
// the date prompt's Ok, the multi-select's Done, and the macro builder's field
// under its pinned footer. Obsidian sets --keyboard-height while the keyboard
// is up; the dialog now sits in the space above it.
const KEYBOARD = 345;

// Settings shows its tab list instead of a page on a phone, so the macro test
// emulates the phone once the builder is open.
const emulatePhoneWithKeyboard = () => getContext().obsidian.dev.evalJson(`(() => {
		window.__qaPhoneClasses = document.body.className;
		document.body.classList.remove("is-tablet");
		document.body.classList.add("is-mobile", "is-phone");
		document.documentElement.style.setProperty("--keyboard-height", "${KEYBOARD}px");
		return true;
	})()`);

afterEach(async () => {
	const { obsidian } = getContext();
	await obsidian.dev.evalJson(`(() => {
		if (window.__qaPhoneClasses !== undefined) document.body.className = window.__qaPhoneClasses;
		delete window.__qaPhoneClasses;
		document.documentElement.style.removeProperty("--keyboard-height");
		for (const container of [...document.querySelectorAll(".modal-container")].reverse()) {
			const close = [...container.querySelectorAll("button")].find((b) => /^(Cancel|Done)$/.test(b.textContent.trim()));
			(close ?? container.querySelector(".modal-close-button"))?.click();
		}
		app.setting.close();
		return true;
	})()`);
	await expect.poll(() => obsidian.dev.evalJson<number>(
		'document.querySelectorAll(".modal-container").length',
	), POLL_OPTS).toBe(0);
});

const aboveKeyboard = (selector: string) => `(() => {
	const el = [...document.querySelectorAll(".modal-container")].pop().querySelector(${jsLiteral(selector)});
	const rect = el.getBoundingClientRect();
	return rect.top >= 0 && rect.bottom <= innerHeight - ${KEYBOARD};
})()`;

it("keeps the date prompt's field and Ok above the keyboard", async () => {
	const { obsidian } = getContext();
	await emulatePhoneWithKeyboard();
	await obsidian.dev.evalJson(`(() => {
		app.plugins.plugins.quickadd.api.format("{{VDATE:due,YYYY-MM-DD}}").catch(() => {});
		return true;
	})()`);
	await waitForElement(obsidian, ".qaDatePrompt .qa-date-picker");
	expect(await obsidian.dev.evalJson<boolean>(aboveKeyboard(".qa-vdate-input"))).toBe(true);
	expect(await obsidian.dev.evalJson<boolean>(aboveKeyboard(".qa-prompt-actions-primary button.mod-cta"))).toBe(true);
});

// Enough options that the dialog is taller than the space above the keyboard.
// The desktop window is wider than 540px, as a phone is in landscape, so the
// multi-select's wide-screen height cap applies.
const OPTIONS = Array.from({ length: 20 }, (_, i) => `Option ${i + 1}`).join(",");

it("keeps the multi-select's Done above the keyboard", async () => {
	const { obsidian } = getContext();
	await emulatePhoneWithKeyboard();
	await obsidian.dev.evalJson(`(() => {
		app.plugins.plugins.quickadd.api.format("{{VALUE:${OPTIONS}|multi}}").catch(() => {});
		return true;
	})()`);
	await waitForElement(obsidian, ".qaMultiSuggester .qa-multi-actions");
	expect(await obsidian.dev.evalJson<boolean>(aboveKeyboard(".qa-multi-actions button.mod-cta"))).toBe(true);
});

it("brings the macro builder's focused field out from under its footer once the keyboard is up", async () => {
	const { obsidian, plugin } = getContext();
	const macro = new MacroChoice("Keyboard macro");
	await plugin.data<{ choices: IChoice[] }>().patch((data) => {
		data.choices = [macro];
	});
	await plugin.reload({ waitUntilReady: true });
	await obsidian.dev.evalJson("app.setting.open(); app.setting.openTabById('quickadd'); true");
	await waitForElement(obsidian, '[aria-label="Configure Keyboard macro"]');
	await obsidian.dev.evalJson(`document.querySelector('[aria-label="Configure Keyboard macro"]').click(), true`);
	await waitForElement(obsidian, ".macroBuilder .qa-modal-footer");
	await emulatePhoneWithKeyboard();

	const coveredByFooter = `(() => {
		const modal = document.querySelector(".macroBuilder");
		const field = [...modal.querySelectorAll("input")].find((input) => input.placeholder.startsWith("Start typing script"));
		return field.getBoundingClientRect().bottom > modal.querySelector(".qa-modal-footer").getBoundingClientRect().top;
	})()`;
	// The field sits low in the builder: with the keyboard taking the bottom of
	// the screen it starts under the footer, as on a phone.
	expect(await obsidian.dev.evalJson<boolean>(`(() => {
		const modal = document.querySelector(".macroBuilder");
		modal.querySelector(".modal-content").scrollTop = 0;
		[...modal.querySelectorAll("input")].find((input) => input.placeholder.startsWith("Start typing script")).focus({ preventScroll: true });
		return ${coveredByFooter};
	})()`)).toBe(true);

	await obsidian.dev.evalJson('window.dispatchEvent(new Event("keyboardDidShow")), true');
	expect(await obsidian.dev.evalJson<boolean>(coveredByFooter)).toBe(false);
});
