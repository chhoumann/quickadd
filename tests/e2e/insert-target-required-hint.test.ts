import { expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness } from "./e2eVault";
import { clickAt, POLL_OPTS, pressKey } from "./uiHelpers";

// #2034: picking After line… / Before line… no longer shows the target field as
// an error before the user has typed in it or left it empty.
const getContext = createQuickAddE2EHarness("insert-target-required-hint");

type FieldState = { hint: string; invalid: string | null } | null;

function field(placeholder: string) {
	return getContext().obsidian.dev.evalJson<FieldState>(`(() => {
		const input = document.querySelector('.captureChoiceBuilder input[placeholder=${JSON.stringify(placeholder)}]');
		if (!input) return null;
		const hint = document.getElementById(input.getAttribute("aria-describedby"));
		return { hint: hint?.textContent ?? "", invalid: input.getAttribute("aria-invalid") };
	})()`);
}

async function pickWritePosition(value: "after" | "before") {
	await getContext().obsidian.dev.evalJson(`(() => {
		const row = [...document.querySelectorAll(".captureChoiceBuilder .setting-item")]
			.find(el => el.querySelector(".setting-item-name")?.textContent.trim() === "Write position");
		const select = row.querySelector("select");
		select.value = ${JSON.stringify(value)};
		select.dispatchEvent(new Event("change", { bubbles: true }));
		return true;
	})()`);
}

it.each([
	["after", "Insert after", "Insert after text is required"],
	["before", "Insert before", "Insert before text is required"],
] as const)("keeps %s-line's empty target neutral until it is left empty", async (position, placeholder, message) => {
	const { obsidian, plugin } = getContext();
	const choice = new CaptureChoice(`Required hint ${position}`);
	choice.captureTo = "Inbox.md";
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
		await expect.poll(() => obsidian.dev.evalJson<boolean>(
			`Boolean(document.querySelector(".captureChoiceBuilder"))`,
		), POLL_OPTS).toBe(true);

		await pickWritePosition(position);
		await expect.poll(() => field(placeholder), POLL_OPTS).toEqual({ hint: "", invalid: "false" });

		// Click into the field and Tab away without typing: now it is an omission.
		const point = await obsidian.dev.evalJson<{ x: number; y: number }>(`(() => {
			const input = document.querySelector('.captureChoiceBuilder input[placeholder=${JSON.stringify(placeholder)}]');
			input.scrollIntoView({ block: "center" });
			const rect = input.getBoundingClientRect();
			return { x: rect.left + 20, y: rect.top + rect.height / 2 };
		})()`);
		await clickAt(obsidian, point.x, point.y);
		await pressKey(obsidian, "Tab");
		await expect.poll(() => field(placeholder), POLL_OPTS).toEqual({ hint: message, invalid: "true" });
	} finally {
		await obsidian.dev.evalJson(`(() => {
			document.querySelectorAll(".captureChoiceBuilder button").forEach(b => b.textContent?.trim() === "Done" && b.click());
			app.setting.close();
			return true;
		})()`);
	}
});
