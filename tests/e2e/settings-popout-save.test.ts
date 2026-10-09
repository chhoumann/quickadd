import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import type IChoice from "../../src/types/choices/IChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import { createQuickAddE2EHarness } from "./e2eVault";
import { setFocusEmulation, setVaultConfig } from "./uiHelpers";

const getContext = createQuickAddE2EHarness("settings-popout-save");

// A change made in the Settings popout is saved after the popout closes right after it (#2182):
// the debounced settings write must not be scheduled on the popout window.
for (const mainWindow of ["visible", "hidden"] as const) {
	it(`saves a reorder made in the Settings popout that closes right after, main window ${mainWindow}`, async () => {
		const { obsidian, plugin } = getContext();
		await plugin.data<{ choices: IChoice[] }>().patch((data) => {
			data.choices = ["Alpha", "Bravo", "Charlie"].map((name) => new TemplateChoice(name));
		});
		await plugin.reload({ waitUntilReady: true });
		const dataPath = path.join(await obsidian.vaultPath(), ".obsidian/plugins/quickadd/data.json");
		const onDisk = () =>
			(JSON.parse(readFileSync(dataPath, "utf8")).choices as IChoice[]).map((choice) => choice.name);
		// The test setup renders the main window as the window in front, which
		// would keep its timers running at full speed while hidden.
		if (mainWindow === "hidden") await setFocusEmulation(obsidian, false);
		const popout = await obsidian.dev.evalJson<boolean>("app.vault.getConfig('settingsPopoutWindow') ?? true");
		try {
			// Reorder by a native mouse drag in the popout, and close it 300 ms after the drop.
			const inMemory = await obsidian.dev.evalJsonAsync<string[]>(`(async () => {
				const remote = require("@electron/remote");
				const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
				${setVaultConfig("settingsPopoutWindow", true)};
				app.setting.open();
				app.setting.openTabById("quickadd");
				let doc;
				for (let i = 0; i < 100 && !doc; i++) {
					await sleep(100);
					doc = app.setting.win?.document;
					if (!doc?.querySelector(".choiceList .qa-drag-handle")) doc = undefined;
				}
				if (!doc) throw new Error("the Settings popout did not show the choice list");
				const popout = doc.defaultView;
				const popoutSleep = (ms) => new Promise((resolve) => popout.setTimeout(resolve, ms));
				const contents = remote.BrowserWindow.getAllWindows().find((win) => win.getTitle().startsWith("Settings")).webContents;
				if (${mainWindow === "hidden"}) {
					remote.getCurrentWindow().hide();
					await popoutSleep(400);
				}
				const centre = (el) => {
					const rect = el.getBoundingClientRect();
					return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
				};
				const handles = doc.querySelectorAll(".choiceList .qa-drag-handle");
				const from = centre(handles[0]);
				const to = centre(handles[2]);
				to.y += 12;
				contents.focus();
				if (activeWindow !== popout) throw new Error("the Settings popout is not the active window");
				contents.sendInputEvent({ type: "mouseMove", x: from.x, y: from.y });
				await popoutSleep(50);
				contents.sendInputEvent({ type: "mouseDown", x: from.x, y: from.y, button: "left", clickCount: 1 });
				await popoutSleep(50);
				for (let step = 1; step <= 12; step++) {
					const y = Math.round(from.y + ((to.y - from.y) * step) / 12);
					contents.sendInputEvent({ type: "mouseMove", x: from.x, y, button: "left", modifiers: ["leftButtonDown"] });
					await popoutSleep(60);
				}
				// While the main window is hidden, the drag library observes on its throttled timers.
				await popoutSleep(${mainWindow === "hidden" ? 2500 : 300});
				contents.sendInputEvent({ type: "mouseUp", x: to.x, y: to.y, button: "left", clickCount: 1 });
				await popoutSleep(300);
				const order = app.plugins.plugins.quickadd.settings.choices.map((choice) => choice.name);
				app.setting.close();
				return order;
			})()`);
			expect(inMemory).not.toEqual(["Alpha", "Bravo", "Charlie"]);
			// The write is debounced by 1 s, and a hidden window's timers run about once a second.
			await expect.poll(onDisk, { timeout: 3000, interval: 250 }).toEqual(inMemory);
		} finally {
			await obsidian.dev.evalJson(`(() => {
				require("@electron/remote").getCurrentWindow().show();
				app.setting.close();
				${setVaultConfig("settingsPopoutWindow", popout)};
				return true;
			})()`);
		}
	});
}
