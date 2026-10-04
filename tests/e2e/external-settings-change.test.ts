import { expect, it } from "vitest";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness } from "./e2eVault";
import { jsLiteral, POLL_OPTS } from "./uiHelpers";
import { storedChoices, withStoredChoices } from "./storedChoices";

// Obsidian calls Plugin#onExternalSettingsChange when data.json is newer than
// the plugin's last write: Sync, another instance on the vault, a hand edit.
// plugin.data().patch() writes the file from outside Obsidian, like those do.
// withStoredChoices writes the choices as QuickAdd 3 actions, as another
// QuickAdd 3 device would.
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
	const choice = plugin.settings.choices.find((c) => c.id === ${jsLiteral(CHOICE_ID)});
	return {
		sameInstance: plugin === window.__qaPluginInstance,
		externalChanges: window.__qaExternalChanges,
		choiceName: choice?.name ?? null,
		command: app.commands.commands[${jsLiteral(COMMAND_ID)}]?.name ?? null,
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

	await plugin.data<QuickAddData>().patch(withStoredChoices((data) => {
		data.choices.push(syncedChoice("Synced from phone"));
	}));
	await expect.poll(() => obsidian.dev.evalJson<LiveState>(LIVE_STATE), POLL_OPTS).toMatchObject({
		sameInstance: true,
		choiceName: "Synced from phone",
		command: "QuickAdd: Synced from phone",
	});

	// A rename elsewhere renames the command; a removal removes it.
	await plugin.data<QuickAddData>().patch(withStoredChoices((data) => {
		data.choices = data.choices.map((c) => (c.id === CHOICE_ID ? { ...c, name: "Renamed on phone" } : c));
	}));
	await expect.poll(() => obsidian.dev.evalJson<LiveState>(LIVE_STATE), POLL_OPTS).toMatchObject({
		choiceName: "Renamed on phone",
		command: "QuickAdd: Renamed on phone",
	});

	await plugin.data<QuickAddData>().patch(withStoredChoices((data) => {
		data.choices = data.choices.filter((c) => c.id !== CHOICE_ID);
	}));
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
	await plugin.data<QuickAddData>().patch(withStoredChoices((data) => {
		data.choices.push(syncedChoice("Synced from phone"));
	}));

	await expect.poll(() => obsidian.dev.evalJson<LiveState>(LIVE_STATE), POLL_OPTS).toMatchObject({
		choiceName: "Synced from phone",
		showCaptureNotification: !before.showCaptureNotification,
	});
	await expect.poll(async () => {
		const disk = await plugin.data<QuickAddData>().read();
		return {
			choice: storedChoices(disk).some((c) => c.id === CHOICE_ID),
			showCaptureNotification: disk.showCaptureNotification,
		};
	}, POLL_OPTS).toEqual({ choice: true, showCaptureNotification: !before.showCaptureNotification });
});

it("merges a choice edited here and a different choice edited elsewhere in the same second", async () => {
	const { obsidian, plugin } = getContext();
	const other = { ...syncedChoice("Journal"), id: `${CHOICE_ID}-other`, command: false } as IChoice;
	await plugin.data<QuickAddData>().patch(withStoredChoices((data) => {
		data.choices.push({ ...syncedChoice("Inbox"), command: false } as IChoice, other);
	}));
	await expect.poll(() => obsidian.dev.evalJson<number>(
		`app.plugins.plugins.quickadd.settings.choices.filter((c) => c.id.startsWith(${jsLiteral(CHOICE_ID)})).length`,
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
		await plugin.data<QuickAddData>().patch(withStoredChoices((data) => {
			data.choices = data.choices.map((c) => (c.id === other.id ? { ...c, name: "Journal (phone)" } : c));
		}));

		const expected = [
			{ id: CHOICE_ID, name: "Inbox", command: true },
			{ id: other.id, name: "Journal (phone)", command: false },
		];
		const ours = (choices: IChoice[]) => choices
			.filter((c) => c.id.startsWith(CHOICE_ID))
			.map(({ id, name, command }) => ({ id, name, command }));
		await expect.poll(async () => ours(storedChoices(await plugin.data<QuickAddData>().read())), POLL_OPTS).toEqual(expected);
		expect(ours(await obsidian.dev.evalJson<IChoice[]>("app.plugins.plugins.quickadd.settings.choices"))).toEqual(expected);
	} finally {
		await obsidian.dev.evalJson("app.setting.close(); true");
	}
});

type StoredData = QuickAddData & { actions?: unknown[]; migrations: Record<string, boolean>; v3Migration?: unknown };

it("adds a choice a QuickAdd 2 device saved next to the actions, then stores it as an action", async () => {
	const { obsidian, plugin } = getContext();
	await obsidian.dev.evalJson(COUNT_EXTERNAL_CHANGES);

	// QuickAdd 2 keeps the `actions` it cannot read and saves its own list.
	await plugin.data<StoredData>().patch((data) => {
		expect(data.actions).toBeDefined();
		data.choices = [syncedChoice("Added on a 2.x device")];
	});
	await expect.poll(() => obsidian.dev.evalJson<LiveState>(LIVE_STATE), POLL_OPTS).toMatchObject({
		sameInstance: true,
		choiceName: "Added on a 2.x device",
		command: "QuickAdd: Added on a 2.x device",
	});

	await obsidian.dev.evalJsonAsync("app.plugins.plugins.quickadd.saveSettings().then(() => true)");
	const disk = await plugin.data<StoredData>().read();
	expect(disk).not.toHaveProperty("choices");
	expect(storedChoices(disk).map((c) => c.name)).toContain("Added on a 2.x device");
});

it("runs a whole QuickAdd 2 file another device wrote, and keeps saving it for QuickAdd 2", async () => {
	const { obsidian, plugin } = getContext();
	await obsidian.dev.evalJson(COUNT_EXTERNAL_CHANGES);

	// An older QuickAdd 2 writes the whole file from its own settings.
	await plugin.data<StoredData>().patch((data) => {
		data.choices = [...storedChoices(data), syncedChoice("Written by 2.x")];
		delete data.actions;
		delete data.v3Migration;
		delete data.migrations.migrateToV3Actions;
	});
	await expect.poll(() => obsidian.dev.evalJson<LiveState>(LIVE_STATE), POLL_OPTS).toMatchObject({
		sameInstance: true,
		choiceName: "Written by 2.x",
		command: "QuickAdd: Written by 2.x",
	});

	// It migrates again on the next launch; until then it stays readable by 2.x.
	await obsidian.dev.evalJsonAsync("app.plugins.plugins.quickadd.saveSettings().then(() => true)");
	const disk = await plugin.data<StoredData>().read();
	expect(disk).not.toHaveProperty("actions");
	expect(disk.choices.map((c) => c.name)).toContain("Written by 2.x");
});

it("does not treat its own saves as external changes", async () => {
	const { obsidian, plugin } = getContext();
	const before = await plugin.data<QuickAddData>().read();
	// The harness restored data.json after the last test; Obsidian reports
	// that change late. Let it arrive before counting.
	await new Promise((resolve) => setTimeout(resolve, 2_500));
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
