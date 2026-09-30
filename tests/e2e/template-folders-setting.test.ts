import { expect, it } from "vitest";
import { createQuickAddE2EHarness } from "./e2eVault";
import { POLL_OPTS, typeInto, waitForElement } from "./uiHelpers";

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

// Settings search indexes a list's items, not its heading, so a vault with no
// template folder yet still needs a row that "template folders" finds.
const QUICKADD_RESULTS = `[...document.querySelectorAll('.setting-search-results .setting-search-result-group')]
	.filter((group) => group.querySelector('.setting-search-result-tab-label')?.textContent === 'QuickAdd')
	.flatMap((group) => [...group.querySelectorAll('.setting-search-result-item')].map((el) => el.textContent.trim()))`;

it.each([
	["no template folder", [], ["Add folder"]],
	["a template folder", ["Templates"], ["Templates"]],
])("finds Template folders in settings search with %s", async (_name, folders, results) => {
	const { obsidian, plugin } = getContext();
	await plugin.data<QuickAddData>().patch((data) => {
		data.templateFolderPaths = folders;
	});
	await plugin.reload({ waitUntilReady: true });

	try {
		await obsidian.dev.evalJson("app.setting.open(); app.setting.openTabById('quickadd'); true");
		await typeInto(obsidian, ".mod-settings .setting-search-container input", "template folders");
		await expect.poll(() => obsidian.dev.evalJson<string[]>(QUICKADD_RESULTS), POLL_OPTS)
			.toEqual(results);
	} finally {
		await obsidian.dev.evalJson("app.setting.close(); true");
	}
});
