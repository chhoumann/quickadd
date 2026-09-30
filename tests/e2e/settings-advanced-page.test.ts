import { expect, it } from "vitest";
import { createQuickAddE2EHarness } from "./e2eVault";
import { POLL_OPTS } from "./uiHelpers";

// #2017: settings most vaults never change live on an Advanced page at the end
// of the tab, and still save from there.
const getContext = createQuickAddE2EHarness("settings-advanced-page");

const rowNames = () => getContext().obsidian.dev.evalJson<string[]>(`(() =>
	[...document.querySelectorAll(".vertical-tab-content .setting-item-name")]
		.filter(el => el.getClientRects().length > 0)
		.map(el => el.textContent.trim())
)()`);

it("opens the Advanced page from the QuickAdd tab and saves its settings", async () => {
	const { obsidian } = getContext();
	try {
		await obsidian.dev.evalJson(`(() => { app.setting.open(); app.setting.openTabById("quickadd"); return true; })()`);
		await expect.poll(rowNames, POLL_OPTS).toContain("Advanced");
		const tab = await rowNames();
		expect(tab.at(-1)).toBe("Advanced");
		expect(tab).not.toContain("Date aliases");
		expect(tab).not.toContain("Allow URI x-callback-url");

		await obsidian.dev.evalJson(`(() => {
			[...document.querySelectorAll(".vertical-tab-content .setting-item")]
				.find(el => el.querySelector(".setting-item-name")?.textContent.trim() === "Advanced").click();
			return true;
		})()`);
		await expect.poll(rowNames, POLL_OPTS).toContain("Date aliases");
		expect(await rowNames()).toEqual(expect.arrayContaining([
			"Search nested choices",
			"Show input cancellation notifications",
			"Global variables",
			"Allow URI x-callback-url",
		]));

		const saved = () => obsidian.dev.evalJson<boolean>(
			"app.plugins.plugins.quickadd.settings.showInputCancellationNotification",
		);
		const before = await saved();
		await obsidian.dev.evalJson(`(() => {
			[...document.querySelectorAll(".vertical-tab-content .setting-item")]
				.find(el => el.querySelector(".setting-item-name")?.textContent.trim() === "Show input cancellation notifications")
				.querySelector(".checkbox-container").click();
			return true;
		})()`);
		await expect.poll(saved, POLL_OPTS).toBe(!before);
	} finally {
		await obsidian.dev.evalJson(`(() => { app.setting.close(); return true; })()`);
	}
});
