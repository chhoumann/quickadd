import { expect, it } from "vitest";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness } from "./e2eVault";
import { POLL_OPTS } from "./uiHelpers";

// Obsidian calls Plugin#onExternalSettingsChange when data.json is newer than
// the plugin's last write: Sync, another instance on the vault, a hand edit.
// plugin.data().patch() writes the file from outside Obsidian, like those do.
const getContext = createQuickAddE2EHarness("external-settings-change");

type QuickAddData = { choices: IChoice[]; showCaptureNotification: boolean };

const CHOICE_ID = "qa-e2e-external-settings";
const COMMAND_ID = `quickadd:choice:${CHOICE_ID}`;

function syncedChoice(name: string): IChoice {
	return {
		id: CHOICE_ID,
		name,
		type: "Capture",
		command: true,
		captureTo: "external-settings.md",
		format: { enabled: true, format: "- {{VALUE}}\n" },
	} as IChoice;
}

/** Count Obsidian's calls into the handler without replacing it. */
const COUNT_EXTERNAL_CHANGES = `(() => {
	const plugin = app.plugins.plugins.quickadd;
	window.__qaExternalChanges = 0;
	window.__qaPluginInstance = plugin;
	const original = plugin.onExternalSettingsChange;
	plugin.onExternalSettingsChange = function () {
		window.__qaExternalChanges++;
		return original.call(this);
	};
	return true;
})()`;

const LIVE_STATE = `(() => {
	const plugin = app.plugins.plugins.quickadd;
	const choice = plugin.settings.choices.find((c) => c.id === ${JSON.stringify(CHOICE_ID)});
	return {
		sameInstance: plugin === window.__qaPluginInstance,
		externalChanges: window.__qaExternalChanges,
		choiceName: choice?.name ?? null,
		command: app.commands.commands[${JSON.stringify(COMMAND_ID)}]?.name ?? null,
		showCaptureNotification: plugin.settings.showCaptureNotification,
	};
})()`;

type LiveState = {
	sameInstance: boolean;
	externalChanges: number;
	choiceName: string | null;
	command: string | null;
	showCaptureNotification: boolean;
};

it("applies choices changed outside Obsidian without a reload, commands included", async () => {
	const { obsidian, plugin } = getContext();
	await obsidian.dev.evalJson(COUNT_EXTERNAL_CHANGES);

	await plugin.data<QuickAddData>().patch((data) => {
		data.choices.push(syncedChoice("Synced from phone"));
	});
	await expect.poll(() => obsidian.dev.evalJson<LiveState>(LIVE_STATE), POLL_OPTS).toMatchObject({
		sameInstance: true,
		choiceName: "Synced from phone",
		command: "QuickAdd: Synced from phone",
	});

	// A rename elsewhere renames the command; a removal removes it.
	await plugin.data<QuickAddData>().patch((data) => {
		data.choices = data.choices.map((c) => (c.id === CHOICE_ID ? { ...c, name: "Renamed on phone" } : c));
	});
	await expect.poll(() => obsidian.dev.evalJson<LiveState>(LIVE_STATE), POLL_OPTS).toMatchObject({
		choiceName: "Renamed on phone",
		command: "QuickAdd: Renamed on phone",
	});

	await plugin.data<QuickAddData>().patch((data) => {
		data.choices = data.choices.filter((c) => c.id !== CHOICE_ID);
	});
	await expect.poll(() => obsidian.dev.evalJson<LiveState>(LIVE_STATE), POLL_OPTS).toMatchObject({
		sameInstance: true,
		choiceName: null,
		command: null,
	});
	expect((await obsidian.dev.evalJson<LiveState>(LIVE_STATE)).externalChanges).toBeGreaterThanOrEqual(3);
});

it("keeps an edit made here that was not saved yet when another device's change lands", async () => {
	const { obsidian, plugin } = getContext();
	const before = await plugin.data<QuickAddData>().read();
	await obsidian.dev.evalJson(COUNT_EXTERNAL_CHANGES);

	// The settings toggle's own write path, then the other device's write
	// inside QuickAdd's one-second save debounce.
	await obsidian.dev.evalJson(`(() => {
		const tab = app.setting.pluginTabs.find((t) => t.id === "quickadd");
		tab.setControlValue("showCaptureNotification", ${!before.showCaptureNotification});
		return true;
	})()`);
	await plugin.data<QuickAddData>().patch((data) => {
		data.choices.push(syncedChoice("Synced from phone"));
	});

	await expect.poll(() => obsidian.dev.evalJson<LiveState>(LIVE_STATE), POLL_OPTS).toMatchObject({
		choiceName: "Synced from phone",
		showCaptureNotification: !before.showCaptureNotification,
	});
	await expect.poll(async () => {
		const disk = await plugin.data<QuickAddData>().read();
		return {
			choice: disk.choices.some((c) => c.id === CHOICE_ID),
			showCaptureNotification: disk.showCaptureNotification,
		};
	}, POLL_OPTS).toEqual({ choice: true, showCaptureNotification: !before.showCaptureNotification });
});

it("merges a choice edited here and a different choice edited elsewhere in the same second", async () => {
	const { obsidian, plugin } = getContext();
	const other = { ...syncedChoice("Journal"), id: `${CHOICE_ID}-other`, command: false } as IChoice;
	await plugin.data<QuickAddData>().patch((data) => {
		data.choices.push({ ...syncedChoice("Inbox"), command: false } as IChoice, other);
	});
	await expect.poll(() => obsidian.dev.evalJson<number>(
		`app.plugins.plugins.quickadd.settings.choices.filter((c) => c.id.startsWith(${JSON.stringify(CHOICE_ID)})).length`,
	), POLL_OPTS).toBe(2);

	try {
		// Here: turn on Inbox's command from the choice list. Elsewhere, inside
		// the one-second save debounce: rename Journal.
		await obsidian.dev.evalJsonAsync(`(async () => {
			app.setting.open();
			app.setting.openTabById("quickadd");
			await new Promise((resolve) => setTimeout(resolve, 300));
			document.querySelector('[aria-label="Command palette: Inbox"]').click();
			return true;
		})()`);
		await plugin.data<QuickAddData>().patch((data) => {
			data.choices = data.choices.map((c) => (c.id === other.id ? { ...c, name: "Journal (phone)" } : c));
		});

		const expected = [
			{ id: CHOICE_ID, name: "Inbox", command: true },
			{ id: other.id, name: "Journal (phone)", command: false },
		];
		const ours = (choices: IChoice[]) => choices
			.filter((c) => c.id.startsWith(CHOICE_ID))
			.map(({ id, name, command }) => ({ id, name, command }));
		await expect.poll(async () => ours((await plugin.data<QuickAddData>().read()).choices), POLL_OPTS).toEqual(expected);
		expect(ours(await obsidian.dev.evalJson<IChoice[]>("app.plugins.plugins.quickadd.settings.choices"))).toEqual(expected);
	} finally {
		await obsidian.dev.evalJson("app.setting.close(); true");
	}
});

it("does not treat its own saves as external changes", async () => {
	const { obsidian, plugin } = getContext();
	const before = await plugin.data<QuickAddData>().read();
	await obsidian.dev.evalJson(COUNT_EXTERNAL_CHANGES);

	await obsidian.dev.evalJson(`(() => {
		const tab = app.setting.pluginTabs.find((t) => t.id === "quickadd");
		tab.setControlValue("showCaptureNotification", ${!before.showCaptureNotification});
		return true;
	})()`);
	await obsidian.dev.evalJsonAsync("app.plugins.plugins.quickadd.saveSettings().then(() => true)");
	expect((await plugin.data<QuickAddData>().read()).showCaptureNotification).toBe(!before.showCaptureNotification);

	// Obsidian debounces its file watcher; give it well past that to call in.
	await new Promise((resolve) => setTimeout(resolve, 2_500));
	expect((await obsidian.dev.evalJson<LiveState>(LIVE_STATE)).externalChanges).toBe(0);
});
