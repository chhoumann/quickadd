import { expect, it } from "vitest";
import { createQuickAddE2EHarness } from "./e2eVault";
import { POLL_OPTS, waitForElement } from "./uiHelpers";

const getContext = createQuickAddE2EHarness("template-folders-setting");

type QuickAddData = { templateFolderPaths: string[] };

const ROW_NAMES = `[...[...document.querySelectorAll('.mod-settings .setting-item-heading')]
	.find((el) => el.textContent.trim() === 'Template folders')
	.parentElement.querySelectorAll('.setting-item:not(.setting-item-heading) .setting-item-name')]
	.map((el) => el.textContent)`;

it("lists template folders in Obsidian's own list and removes one from its row", async () => {
	const { obsidian, plugin } = getContext();
	await plugin.data<QuickAddData>().patch((data) => {
		data.templateFolderPaths = ["Templates", "Areas/Work/"];
	});
	await plugin.reload({ waitUntilReady: true });

	try {
		await obsidian.dev.evalJson("app.setting.open(); app.setting.openTabById('quickadd'); true");
		await waitForElement(obsidian, ".mod-settings .setting-item-heading");
		// Stored paths are shown normalized, one row each.
		await expect.poll(() => obsidian.dev.evalJson<string[]>(ROW_NAMES), POLL_OPTS)
			.toEqual(["Templates", "Areas/Work"]);

		await obsidian.dev.evalJson(`(() => {
			const row = [...document.querySelectorAll('.mod-settings .setting-item')]
				.find((el) => el.querySelector('.setting-item-name')?.textContent === 'Templates');
			row.querySelector('[aria-label="Delete"]').click();
			return true;
		})()`);

		await expect.poll(() => obsidian.dev.evalJson<string[]>(ROW_NAMES), POLL_OPTS)
			.toEqual(["Areas/Work"]);
		expect(await obsidian.dev.evalJson<string[]>(
			"app.plugins.plugins.quickadd.settings.templateFolderPaths",
		)).toEqual(["Areas/Work"]);
	} finally {
		await obsidian.dev.evalJson("app.setting.close(); true");
	}
});
