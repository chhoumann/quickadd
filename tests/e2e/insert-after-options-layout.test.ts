import { expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness } from "./e2eVault";
import { POLL_OPTS } from "./uiHelpers";

// #2048: a dropdown is as wide as its longest option, so a long option label
// squeezed the row's name into a narrow column beside it.
const getContext = createQuickAddE2EHarness("insert-after-options-layout");

it("keeps the names of the ordered placement rows on one line", async () => {
	const { obsidian, plugin } = getContext();
	const choice = new CaptureChoice("Ordered layout");
	choice.captureTo = "Log.md";
	choice.insertAfter = {
		...choice.insertAfter,
		enabled: true,
		after: "## {{DATE}}",
		createIfNotFound: true,
		createIfNotFoundLocation: "ordered",
		orderBy: { by: "date", direction: "desc", dateFormat: "YYYY-MM-DD", unparseable: "bottom" },
	};
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

		// Lines the name's text occupies, counted from its line boxes.
		const nameLines = () => obsidian.dev.evalJson<Record<string, number>>(`(() => {
			const lines = {};
			for (const row of document.querySelectorAll(".captureChoiceBuilder .setting-item")) {
				const name = row.querySelector(".setting-item-name");
				const label = name?.textContent.trim();
				if (label !== "Create line if not found" && label !== "Existing unparseable headings") continue;
				const range = document.createRange();
				range.selectNodeContents(name);
				lines[label] = new Set([...range.getClientRects()].map(r => Math.round(r.top))).size;
			}
			return lines;
		})()`);

		await expect.poll(nameLines, POLL_OPTS).toEqual({
			"Create line if not found": 1,
			"Existing unparseable headings": 1,
		});
	} finally {
		await obsidian.dev.evalJson(`(() => {
			document.querySelectorAll(".captureChoiceBuilder button").forEach(b => b.textContent?.trim() === "Done" && b.click());
			app.setting.close();
			return true;
		})()`);
	}
});
