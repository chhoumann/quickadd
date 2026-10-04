import { afterEach, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { withStoredChoices } from "./storedChoices";
import { clickWhenStill, jsLiteral, POLL_OPTS, waitForElement } from "./uiHelpers";

// Settings -> QuickAdd lists the last runs on this device under "Run log".
const getContext = createQuickAddE2EHarness("v3-run-log");

const entries = `Array.from(document.querySelectorAll(".mod-settings .qa-run-log-entry"), (entry) => ({
	name: entry.querySelector(".qa-run-log-name").textContent,
	what: entry.querySelector(".qa-run-log-what").textContent,
	note: entry.querySelector(".qa-run-log-note")?.textContent ?? null,
}))`;

afterEach(async () => {
	await getContext().obsidian.dev.evalJson("(() => { app.setting.close(); return true; })()");
});

it("lists the last runs, newest first, and clears them", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const inbox = await seedVaultFile(obsidian, sandbox, "inbox.md", "# Inbox\n");
	const journal = await seedVaultFile(obsidian, sandbox, "journal.md", "# Journal\n");
	const first = new CaptureChoice("Add to inbox");
	first.captureTo = inbox;
	first.format = { enabled: true, format: "- one" };
	const second = new CaptureChoice("Add to journal");
	second.captureTo = journal;
	second.format = { enabled: true, format: "- two" };
	await plugin.data<{ choices: IChoice[] }>().patch(withStoredChoices((data) => {
		data.choices = [first, second];
		for (const choice of data.choices) choice.onePageInput = "never";
	}));
	// Start from an empty log: it lives in run-log.json, which the harness does not restore.
	await obsidian.dev.evalJsonAsync(`(async () => {
		const path = app.plugins.plugins.quickadd.manifest.dir + "/run-log.json";
		if (await app.vault.adapter.exists(path)) await app.vault.adapter.remove(path);
		return true;
	})()`);
	await plugin.reload({ waitUntilReady: true });

	for (const choice of [first, second]) {
		await obsidian.dev.evalJsonAsync(`app.plugins.plugins.quickadd.api.executeChoice(${jsLiteral(choice.name)}).then(() => true)`);
	}

	await obsidian.dev.evalJson("(() => { app.setting.open(); app.setting.openTabById('quickadd'); return true; })()");
	await waitForElement(obsidian, ".mod-settings .qa-run-log");
	await expect.poll(() => obsidian.dev.evalJson(entries), POLL_OPTS).toEqual([
		{ name: "Add to journal", what: "added to", note: "journal" },
		{ name: "Add to inbox", what: "added to", note: "inbox" },
	]);

	await clickWhenStill(obsidian, ".mod-settings .qa-run-log-actions button");
	await expect.poll(() => obsidian.dev.evalJson(entries), POLL_OPTS).toEqual([]);
	expect(await obsidian.dev.evalJson<string>(`document.querySelector(".mod-settings .qa-run-log-empty")?.textContent ?? ""`))
		.toBe("No runs yet");
});
