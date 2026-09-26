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
		const rows = await obsidian.dev.evalJson<Record<string, number>>(`(() => Object.fromEntries(
			[...document.querySelectorAll('.mod-settings .vertical-tab-content .setting-item')]
				.filter((row) => row.querySelector(':scope > .setting-item-control > select'))
				.map((row) => [
					row.querySelector('.setting-item-name').textContent,
					row.querySelector(':scope > .setting-item-info').getBoundingClientRect().width /
						row.getBoundingClientRect().width,
				]),
		))()`);
		expect(Object.keys(rows)).toEqual(
			expect.arrayContaining(["Announce updates", "“New note from template” in the launcher"]),
		);
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
