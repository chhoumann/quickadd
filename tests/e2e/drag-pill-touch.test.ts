import { expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness } from "./e2eVault";
import { POLL_OPTS, waitForElement } from "./uiHelpers";
import { withStoredChoices } from "./storedChoices";

const getContext = createQuickAddE2EHarness("drag-pill-touch");

// #2136: a touch drag starts after the long-press without moving, and the
// library only turned its full-row clone into the pill once the finger moved,
// so until then the dragged row was drawn over the next one.
it("shows the drag pill as soon as a long-press starts a touch drag", async () => {
	const { obsidian, plugin } = getContext();
	await plugin.data<{ choices: IChoice[] }>().patch(withStoredChoices((data) => {
		data.choices = ["Touch first", "Touch second", "Touch third"].map((name) => new CaptureChoice(name));
	}));
	await plugin.reload({ waitUntilReady: true });
	await obsidian.dev.evalJson("app.setting.open(); app.setting.openTabById('quickadd'); true");
	await waitForElement(obsidian, '[aria-label="Reorder Touch first"]');

	try {
		// Desktop rows drag once their handle is pressed; a phone's whole row is
		// draggable. Press it, then hold a finger on the row without moving,
		// past the 200 ms long-press.
		expect(await obsidian.dev.evalJsonAsync(`(async () => {
			const handle = document.querySelector('[aria-label="Reorder Touch first"]');
			const row = handle.closest(".choiceListItem");
			handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
			await new Promise((resolve) => setTimeout(resolve, 50));
			const rect = row.getBoundingClientRect();
			window.__qaTouch = new Touch({ identifier: 1, target: row, clientX: rect.left + 40, clientY: rect.top + rect.height / 2 });
			row.dispatchEvent(new TouchEvent("touchstart", { touches: [window.__qaTouch], changedTouches: [window.__qaTouch], bubbles: true, cancelable: true }));
			await new Promise((resolve) => setTimeout(resolve, 400));
			const clone = document.getElementById("dnd-action-dragged-el");
			return clone && {
				pill: clone.classList.contains("qa-drag-clone"),
				label: clone.querySelector(".qa-drag-pill-label")?.textContent ?? null,
			};
		})()`)).toEqual({ pill: true, label: "Touch first" });
	} finally {
		await obsidian.dev.evalJson(`(() => {
			const touch = window.__qaTouch;
			delete window.__qaTouch;
			if (touch) window.dispatchEvent(new TouchEvent("touchend", { changedTouches: [touch], bubbles: true, cancelable: true }));
			window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
			return true;
		})()`);
		await expect.poll(() => obsidian.dev.evalJson<boolean>(
			'Boolean(document.getElementById("dnd-action-dragged-el"))',
		), POLL_OPTS).toBe(false);
		await obsidian.dev.evalJson("app.setting.close(), true");
	}
	// A hold-and-release keeps every choice (#1692).
	expect(await obsidian.dev.evalJson<string[]>(
		"app.plugins.plugins.quickadd.settings.choices.map((choice) => choice.name)",
	)).toEqual(["Touch first", "Touch second", "Touch third"]);
});
