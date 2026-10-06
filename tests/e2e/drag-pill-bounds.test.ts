import { expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness } from "./e2eVault";
import { waitForElement } from "./uiHelpers";
import { withStoredChoices } from "./storedChoices";

const getContext = createQuickAddE2EHarness("drag-pill-bounds");

const LONG_NAME = "A choice name long enough to fill the whole drag pill while it is being dragged";

it("keeps the drag pill inside a narrow window with the grip under the cursor", async () => {
	const { obsidian, plugin } = getContext();
	await plugin.data<{ choices: IChoice[] }>().patch(withStoredChoices((data) => {
		data.choices = [new CaptureChoice(LONG_NAME), new CaptureChoice("Second")];
	}));
	await plugin.reload({ waitUntilReady: true });
	const mouse = async (type: string, x: number, y: number, buttons: number) => {
		const params = { type, x, y, button: buttons ? "left" : "none", buttons, clickCount: 1 };
		const reply = await obsidian.execText("dev:cdp", { method: "Input.dispatchMouseEvent", params: JSON.stringify(params) });
		if (!reply.startsWith("{")) throw new Error(`dev:cdp failed: ${reply}`);
	};
	const originalSize = await obsidian.dev.evalJson<number[]>(`require("@electron/remote").getCurrentWindow().getSize()`);
	const popout = await obsidian.dev.evalJson<boolean>("app.vault.getConfig('settingsPopoutWindow') ?? true");
	let pressedAt: number[] | null = null;
	try {
		// Narrow enough that a pill growing right from the handle runs off the window.
		await obsidian.dev.evalJson(`require("@electron/remote").getCurrentWindow().setSize(900, 700), true`);
		await expect.poll(() => obsidian.dev.evalJson<number>("innerWidth")).toBe(900);
		await obsidian.dev.evalJson("app.vault.setConfig('settingsPopoutWindow', false), app.setting.open(), app.setting.openTabById('quickadd'), true");
		const handleSelector = `[aria-label=${JSON.stringify(`Reorder ${LONG_NAME}`)}]`;
		await waitForElement(obsidian, handleSelector);
		const [x, y] = await obsidian.dev.evalJson<number[]>(`(() => {
			const rect = document.querySelector(${JSON.stringify(handleSelector)}).getBoundingClientRect();
			return [Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2)];
		})()`);

		await mouse("mouseMoved", x, y, 0);
		await mouse("mousePressed", x, y, 1);
		pressedAt = [x, y];
		for (const dy of [4, 8, 12, 16, 20]) await mouse("mouseMoved", x, y + dy, 1);
		await waitForElement(obsidian, "#dnd-action-dragged-el .qa-drag-pill");

		const pill = await obsidian.dev.evalJson<{ left: number; right: number; gripX: number; viewport: number }>(`(() => {
			const pill = document.querySelector("#dnd-action-dragged-el .qa-drag-pill").getBoundingClientRect();
			const grip = document.querySelector("#dnd-action-dragged-el .qa-drag-pill-grip").getBoundingClientRect();
			return { left: pill.left, right: pill.right, gripX: grip.left + grip.width / 2, viewport: innerWidth };
		})()`);
		expect(pill.left).toBeGreaterThanOrEqual(0);
		expect(pill.right).toBeLessThanOrEqual(pill.viewport);
		expect(Math.abs(pill.gripX - x)).toBeLessThan(4);
	} finally {
		// Drop it back where it was picked up.
		if (pressedAt) await mouse("mouseReleased", pressedAt[0], pressedAt[1], 1);
		await obsidian.dev.evalJson(`(() => {
			app.setting.close();
			app.vault.setConfig('settingsPopoutWindow', ${JSON.stringify(popout)});
			require("@electron/remote").getCurrentWindow().setSize(${originalSize[0]}, ${originalSize[1]});
			return true;
		})()`);
	}
});
