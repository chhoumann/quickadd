import { afterEach, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import type { Action, ActionNode } from "../../src/v3/model";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { withStoredChoices } from "./storedChoices";
import { clickWhenStill, insertText, jsLiteral, leaveSettingsPage, POLL_OPTS } from "./uiHelpers";

// "Show in ribbon" is the first setting only a QuickAdd 3 action holds: no v2
// choice can, so it lives through loads, saves and synced changes only because
// the stored actions own it.
const getContext = createQuickAddE2EHarness("v3-action-ribbon");

type Data = { choices: IChoice[]; actions: ActionNode[] };

afterEach(async () => {
	await getContext().obsidian.dev.evalJson("app.setting.close(), true");
});

function logCapture(id: string, name: string, line: string): CaptureChoice {
	const choice = new CaptureChoice(name);
	choice.id = id;
	choice.captureTo = getContext().sandbox.path("ribbon-log.md");
	choice.format = { enabled: true, format: `- ${line}\n` };
	choice.prepend = true;
	return choice;
}

const ribbonIcon = (name: string) => `.side-dock-ribbon-action[aria-label=${jsLiteral(name)}]`;

const ribbonIconCount = (name: string) =>
	getContext().obsidian.dev.evalJson<number>(`document.querySelectorAll(${jsLiteral(ribbonIcon(name))}).length`);

const openSettings = () =>
	getContext().obsidian.dev.evalJson("app.setting.open(), app.setting.openTabById('quickadd'), true");

const storedAction = async (id: string) =>
	(await getContext().plugin.data<Data>().read()).actions.find((node): node is Action => node.id === id);

it("shows an action in the ribbon from its settings, and the icon runs it after an edit, a reload and a synced change", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	await seedVaultFile(obsidian, sandbox, "ribbon-log.md", "# Log\n");
	await plugin.data<Data>().patch(withStoredChoices((data) => {
		data.choices = [
			logCapture("qa-ribbon-log", "Ribbon log", "from the ribbon"),
			logCapture("qa-ribbon-synced", "Synced ribbon log", "from the synced icon"),
		];
	}));
	await plugin.reload({ waitUntilReady: true });
	expect(await ribbonIconCount("Ribbon log")).toBe(0);

	await openSettings();
	await clickWhenStill(obsidian, '[aria-label="Configure Ribbon log"]');
	// A new capture keeps the setting under More settings.
	await clickWhenStill(obsidian, '.qa-builder-page .qaMoreSettings button[aria-label="More settings"][aria-expanded="false"]');
	await clickWhenStill(obsidian, '.qa-builder-page [role="switch"][aria-label="Show in ribbon"]');
	await leaveSettingsPage(obsidian);
	await obsidian.dev.evalJson("app.setting.close(), true");

	// The icon appears as the toggle flips, and the action keeps the setting on disk.
	await expect.poll(() => ribbonIconCount("Ribbon log"), POLL_OPTS).toBe(1);
	await expect.poll(async () => (await storedAction("qa-ribbon-log"))?.show.ribbon, POLL_OPTS).toBe(true);

	// An edit to a setting a v2 choice holds saves through the choice, and
	// the action keeps its ribbon setting; the icon takes the new name.
	await openSettings();
	await clickWhenStill(obsidian, '[aria-label="Configure Ribbon log"]');
	await obsidian.dev.evalJson(`(() => {
		const input = document.querySelector(".qa-builder-page .setting-group input");
		input.focus();
		input.select();
		return true;
	})()`);
	await insertText(obsidian, "Daily ribbon log");
	await leaveSettingsPage(obsidian);
	await obsidian.dev.evalJson("app.setting.close(), true");
	await expect.poll(() => ribbonIconCount("Daily ribbon log"), POLL_OPTS).toBe(1);
	expect(await ribbonIconCount("Ribbon log")).toBe(0);
	await expect.poll(async () => await storedAction("qa-ribbon-log"), POLL_OPTS).toMatchObject({
		name: "Daily ribbon log",
		show: { ribbon: true },
	});

	await plugin.reload({ waitUntilReady: true });
	expect(await ribbonIconCount("Daily ribbon log")).toBe(1);
	await clickWhenStill(obsidian, ribbonIcon("Daily ribbon log"));
	await sandbox.waitForContent("ribbon-log.md", (text) => text === "# Log\n- from the ribbon\n");

	// Another device shows the second action in the ribbon, with a field
	// this build does not know.
	await plugin.data<Data>().patch((data) => {
		const synced = data.actions.find((node) => node.id === "qa-ribbon-synced") as Action & { laterField?: string };
		synced.show.ribbon = true;
		synced.laterField = "from a later QuickAdd";
	});
	await expect.poll(() => ribbonIconCount("Synced ribbon log"), POLL_OPTS).toBe(1);
	expect(await ribbonIconCount("Daily ribbon log")).toBe(1);
	await clickWhenStill(obsidian, ribbonIcon("Synced ribbon log"));
	await sandbox.waitForContent("ribbon-log.md", (text) => text.endsWith("- from the synced icon\n"));

	// A save writes both actions back as they are.
	await obsidian.dev.evalJson("app.plugins.plugins.quickadd.saveSettings(), true");
	await expect.poll(async () => [await storedAction("qa-ribbon-log"), await storedAction("qa-ribbon-synced")], POLL_OPTS).toMatchObject([
		{ show: { ribbon: true } },
		{ show: { ribbon: true }, laterField: "from a later QuickAdd" },
	]);
});
