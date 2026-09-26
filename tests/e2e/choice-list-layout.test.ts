import { expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import { MultiChoice } from "../../src/types/choices/MultiChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness } from "./e2eVault";
import { pressKey, waitForElement } from "./uiHelpers";

const getContext = createQuickAddE2EHarness("choice-list-layout");

it.each(["is-phone", "is-tablet"])("keeps choice controls compact under %s host styles", async (deviceClass) => {
	const { obsidian, plugin } = getContext();
	await plugin.data<{ choices: IChoice[] }>().patch((data) => {
		data.choices = [new CaptureChoice("Layout capture"), new MultiChoice("Layout folder")];
	});
	await plugin.reload({ waitUntilReady: true });
	try {
		await obsidian.dev.evalJson("app.setting.open(); app.setting.openTabById('quickadd'); true");
		await waitForElement(obsidian, ".multiChoiceListItemName");
		const layout = await obsidian.dev.evalJson<{
			folderPadding: string;
			folderHeight: number;
			leafHeight: number;
			actions: { padding: string; width: number; height: number }[];
		}>(`(() => {
			const original = document.body.className;
			try {
				document.body.classList.remove('is-phone', 'is-tablet');
				document.body.classList.add('is-mobile', ${JSON.stringify(deviceClass)});
				const folder = document.querySelector('.multiChoiceListItemName');
				const leaf = document.querySelector('.choiceListItem');
				if (!folder?.closest('.modal .setting-item-control') || !leaf) throw new Error('Missing native settings context');
				const actions = [...document.querySelectorAll('.rightButtonsContainer .qa-icon-button')]
					.filter(e => getComputedStyle(e).display !== 'none')
					.map(e => ({ padding: getComputedStyle(e).padding, width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height }));
				return { folderPadding: getComputedStyle(folder).padding, folderHeight: folder.closest('.multiChoiceListItem').getBoundingClientRect().height, leafHeight: leaf.getBoundingClientRect().height, actions };
			} finally { document.body.className = original; }
		})()`);
		expect(layout.folderPadding).toBe("0px");
		expect(layout.folderHeight).toBeCloseTo(layout.leafHeight, 0);
		expect(layout.actions.length).toBeGreaterThan(0);
		for (const action of layout.actions) {
			expect(action.padding).toBe("8px");
			expect(action.width).toBeGreaterThan(0);
			expect(action.width).toBeLessThan(40);
			expect(action.height).toBeLessThan(40);
		}
	} finally {
		await obsidian.dev.evalJson("app.setting.close(); true");
	}
});

it("opens the New choice menu under its button", async () => {
	const { obsidian } = getContext();
	try {
		await obsidian.dev.evalJson("app.setting.open(); app.setting.openTabById('quickadd'); true");
		await waitForElement(obsidian, ".qaNewChoiceBtn.mod-cta");
		await obsidian.dev.evalJson("document.querySelector('.qaNewChoiceBtn.mod-cta').click(); true");
		await waitForElement(obsidian, ".menu");
		const { button, menu } = await obsidian.dev.evalJson<{
			button: { left: number; right: number; bottom: number };
			menu: { left: number; right: number; top: number };
		}>(`(() => {
			const rect = (selector) => {
				const { left, right, top, bottom } = document.querySelector(selector).getBoundingClientRect();
				return { left, right, top, bottom };
			};
			return { button: rect('.qaNewChoiceBtn.mod-cta'), menu: rect('.menu') };
		})()`);
		expect(menu.top).toBeGreaterThan(button.bottom);
		expect(menu.right).toBeCloseTo(button.right, 0);
		expect(menu.left).toBeLessThan(button.left);
	} finally {
		await pressKey(obsidian, "Escape");
		await obsidian.dev.evalJson("app.setting.close(); true");
	}
});
