import { expect, it } from "vitest";
import { createQuickAddE2EHarness } from "./e2eVault";
import { waitForElement } from "./uiHelpers";

const getContext = createQuickAddE2EHarness("one-page-alignment");

it("starts every one-page control at the same x regardless of label length", async () => {
	const { obsidian } = getContext();
	try {
		await obsidian.dev.evalJson(`(() => {
			const inputs = [];
			for (const type of ['text', 'textarea', 'number', 'slider', 'suggester']) {
				for (const label of ['A', 'A considerably longer label for this field']) {
					inputs.push({ id: type + label, label, type, options: ['x'], sliderConfig: { min: 0, max: 10 } });
				}
			}
			void app.plugins.plugins.quickadd.api.requestInputs(inputs).catch(() => undefined);
			return true;
		})()`);
		await waitForElement(obsidian, ".onePageInputModal .qa-onepage-slider");
		const lefts = await obsidian.dev.evalJson<Record<string, number>>(`(() => Object.fromEntries(
			[...[...document.querySelectorAll('.onePageInputModal')].at(-1).querySelectorAll('.setting-item')].map((row, index) => [
				index + ': ' + row.querySelector('.setting-item-name').textContent,
				row.querySelector('input, textarea').getBoundingClientRect().left,
			]),
		))()`);
		const values = Object.values(lefts);
		expect(values).toHaveLength(10);
		for (const [row, left] of Object.entries(lefts)) {
			expect(left, row).toBeCloseTo(values[0], 0);
		}
	} finally {
		await obsidian.dev.evalJson(`(() => {
			[...[...document.querySelectorAll('.onePageInputModal')].at(-1).querySelectorAll('button')].find(e => e.textContent === 'Cancel')?.click();
			return true;
		})()`);
	}
});
