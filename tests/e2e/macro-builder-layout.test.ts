import { expect, it } from "vitest";
import { MacroChoice } from "../../src/types/choices/MacroChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness } from "./e2eVault";
import { POLL_OPTS, waitForElement } from "./uiHelpers";

const getContext = createQuickAddE2EHarness("macro-builder-layout");

// #2128: on a phone Obsidian makes every input and button in a modal's setting
// row full width, so a row's input and its Add button split it and the
// placeholders were cut mid-word.
it("gives the macro builder's inputs the row on a phone", async () => {
	const { obsidian, plugin } = getContext();
	const macro = new MacroChoice("Phone layout macro");
	await plugin.data<{ choices: IChoice[] }>().patch((data) => {
		data.choices = [macro];
	});
	await plugin.reload({ waitUntilReady: true });
	try {
		await obsidian.dev.evalJson("app.setting.open(); app.setting.openTabById('quickadd'); true");
		await waitForElement(obsidian, '[aria-label="Configure Phone layout macro"]');
		await obsidian.dev.evalJson(`document.querySelector('[aria-label="Configure Phone layout macro"]').click(), true`);
		await waitForElement(obsidian, ".macroBuilder .qa-command-sequence-input");
		await obsidian.dev.evalJson(`(() => {
			window.__qaPhoneClasses = document.body.className;
			document.body.classList.remove("is-tablet");
			document.body.classList.add("is-mobile", "is-phone");
			return true;
		})()`);

		const rows = await obsidian.dev.evalJson<{ field: number; button: number }[]>(`(() =>
			[...document.querySelectorAll(".macroBuilder .setting-item-control:has(> .qa-command-sequence-input)")].map((row) => {
				const button = [...row.querySelectorAll(":scope > button")].find((b) => b.getClientRects().length);
				return {
					field: row.querySelector(":scope > .qa-command-sequence-input").getBoundingClientRect().width,
					button: button.getBoundingClientRect().width,
				};
			}))()`);
		expect(rows).toHaveLength(4);
		for (const { field, button } of rows) {
			expect(button).toBeLessThan(100);
			expect(field).toBeGreaterThan(button * 2);
		}
	} finally {
		await obsidian.dev.evalJson(`(() => {
			if (window.__qaPhoneClasses !== undefined) document.body.className = window.__qaPhoneClasses;
			delete window.__qaPhoneClasses;
			[...document.querySelectorAll(".macroBuilder button")].find((b) => b.textContent.trim() === "Done")?.click();
			app.setting.close();
			return true;
		})()`);
		await expect.poll(() => obsidian.dev.evalJson<number>(
			'document.querySelectorAll(".modal-container").length',
		), POLL_OPTS).toBe(0);
	}
});
