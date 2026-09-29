import { expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness } from "./e2eVault";
import { clickAt, POLL_OPTS, pressKey } from "./uiHelpers";

// #1875: Tab in the builder's Capture format box indents, while tabbing through
// the builder still passes the box by without editing it.
const getContext = createQuickAddE2EHarness("capture-format-tab");

const FORMAT = "- {{VALUE}}\n";

function inBuilder<T>(expression: string): Promise<T> {
	return getContext().obsidian.dev.evalJson<T>(`(() => {
		const builder = [...document.querySelectorAll(".captureChoiceBuilder")]
			.filter(el => el.getClientRects().length > 0).at(-1);
		if (!builder) throw new Error("Capture builder not open");
		const row = [...builder.querySelectorAll(".setting-item")]
			.find(el => el.querySelector(".setting-item-name")?.textContent === "Capture format");
		const toggle = row?.querySelector(".checkbox-container");
		const format = builder.querySelector("textarea");
		return (${expression});
	})()`);
}

async function pressTab(shift = false) {
	for (const type of ["rawKeyDown", "keyUp"]) {
		await getContext().obsidian.exec("dev:cdp", {
			method: "Input.dispatchKeyEvent",
			params: JSON.stringify({ type, key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: shift ? 8 : 0 }),
		});
	}
}

const focusIsFormat = () => inBuilder<boolean>("document.activeElement === format");
const formatValue = () => inBuilder<string>("format.value");

it("indents the Capture format on Tab without trapping keyboard navigation", async () => {
	const { obsidian, plugin } = getContext();
	const choice = new CaptureChoice("Tab format capture");
	choice.captureTo = "Inbox.md";
	choice.format = { enabled: true, format: FORMAT };
	await plugin.data<{ choices: IChoice[] }>().patch((data) => {
		data.choices = [choice];
	});
	await plugin.reload({ waitUntilReady: true });

	try {
		await obsidian.dev.evalJson(`(() => {
			app.setting.open(); app.setting.openTabById("quickadd");
			[...document.querySelectorAll('[aria-label="Configure ${choice.name}"]')]
				.find(el => el.getClientRects().length > 0).click();
			return true;
		})()`);
		await expect.poll(() => inBuilder<boolean>("Boolean(format)"), POLL_OPTS).toBe(true);

		// Tabbing through the form stops at the box and then moves on, unedited.
		await inBuilder("(toggle.focus(), true)");
		await pressTab();
		expect(await focusIsFormat()).toBe(true);
		await pressTab();
		expect(await focusIsFormat()).toBe(false);
		expect(await formatValue()).toBe(FORMAT);

		// Once the user is editing the box, Tab inserts a tab character.
		const point = await inBuilder<{ x: number; y: number }>(`(() => {
			format.scrollIntoView({ block: "center" });
			const rect = format.getBoundingClientRect();
			return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
		})()`);
		await clickAt(obsidian, point.x, point.y);
		expect(await focusIsFormat()).toBe(true);
		await inBuilder("(format.setSelectionRange(format.value.length, format.value.length), true)");
		await pressTab();
		expect(await focusIsFormat()).toBe(true);
		await obsidian.exec("dev:cdp", { method: "Input.insertText", params: JSON.stringify({ text: "- detail" }) });
		expect(await formatValue()).toBe(`${FORMAT}\t- detail`);

		// Shift+Tab still leaves the box.
		await pressTab(true);
		expect(await focusIsFormat()).toBe(false);

		await pressKey(obsidian, "Escape");
		await expect.poll(() => obsidian.dev.evalJson<string | undefined>(
			`app.plugins.plugins.quickadd.settings.choices.find(c => c.id === ${JSON.stringify(choice.id)})?.format.format`,
		), POLL_OPTS).toBe(`${FORMAT}\t- detail`);
	} finally {
		await obsidian.dev.evalJson(`(() => {
			for (const builder of document.querySelectorAll(".captureChoiceBuilder")) {
				[...builder.querySelectorAll("button.mod-cta")].find(b => b.textContent?.trim() === "Done")?.click();
			}
			app.setting.close();
			return true;
		})()`);
	}
});
