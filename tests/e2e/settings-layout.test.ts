import { expect, it } from "vitest";
import { createQuickAddE2EHarness } from "./e2eVault";
import { waitForElement } from "./uiHelpers";

const getContext = createQuickAddE2EHarness("settings-layout");

it("leaves every dropdown's label room in an 800px window", async () => {
	const { obsidian } = getContext();
	const size = await obsidian.dev.evalJson<number[]>(
		"require('electron').remote.getCurrentWindow().getSize()",
	);
	try {
		await obsidian.dev.evalJson(
			"require('electron').remote.getCurrentWindow().setSize(800, 800); true",
		);
		await expect.poll(() => obsidian.dev.evalJson<number>("innerWidth")).toBe(800);
		await obsidian.dev.evalJson("app.setting.open(); app.setting.openTabById('quickadd'); true");
		await waitForElement(obsidian, ".mod-settings .setting-item select");
		const dropdownRows = () => obsidian.dev.evalJson<Record<string, number>>(`(() => Object.fromEntries(
			[...document.querySelectorAll('.mod-settings .vertical-tab-content .setting-item')]
				.filter((row) => row.querySelector(':scope > .setting-item-control > select'))
				.map((row) => [
					row.querySelector('.setting-item-name').textContent,
					row.querySelector(':scope > .setting-item-info').getBoundingClientRect().width /
						row.getBoundingClientRect().width,
				]),
		))()`);
		const tabRows = await dropdownRows();
		expect(Object.keys(tabRows)).toContain("Announce updates");
		// The launcher row lives on the Advanced page (#2017).
		await obsidian.dev.evalJson(`(() => {
			[...document.querySelectorAll('.mod-settings .vertical-tab-content .setting-item')]
				.find((row) => row.querySelector('.setting-item-name')?.textContent.trim() === 'Advanced').click();
			return true;
		})()`);
		await expect.poll(async () => Object.keys(await dropdownRows()))
			.toContain("“New note from template” in the launcher");
		const rows = { ...tabRows, ...(await dropdownRows()) };
		for (const [name, share] of Object.entries(rows)) {
			expect(share, name).toBeGreaterThanOrEqual(0.5);
		}
	} finally {
		await obsidian.dev.evalJson(`(() => {
			app.setting.close();
			require('electron').remote.getCurrentWindow().setSize(${size[0]}, ${size[1]});
			return true;
		})()`);
	}
});
