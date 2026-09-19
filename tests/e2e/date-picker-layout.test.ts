import { expect, it } from "vitest";
import { createQuickAddE2EHarness } from "./e2eVault";
import { POLL_OPTS, pressKey, waitForElement } from "./uiHelpers";

const getContext = createQuickAddE2EHarness("date-picker-layout");

it("focuses the first form field through the host and submits from the keyboard", async () => {
	const { obsidian } = getContext();
	try {
		await obsidian.dev.evalJson(`(() => {
			window.__qaFocusResult = null;
			void app.plugins.plugins.quickadd.api.requestInputs([
				{ id: 'title', label: 'Title', type: 'text' },
				{ id: 'body', label: 'Body', type: 'textarea', optional: true },
			]).then(value => window.__qaFocusResult = value).catch(() => undefined);
			return true;
		})()`);
		await waitForElement(obsidian, ".onePageInputModal input");
		expect(await obsidian.dev.evalJson<boolean>(
			"document.activeElement === document.querySelector('.onePageInputModal input')",
		)).toBe(true);
		await obsidian.exec("dev:cdp", {
			method: "Input.insertText",
			params: JSON.stringify({ text: "Native focus" }),
		});
		await pressKey(obsidian, "Enter", true);
		await expect.poll(() => obsidian.dev.evalJson<string | null>(
			"window.__qaFocusResult?.title ?? null",
		), POLL_OPTS).toBe("Native focus");
	} finally {
		await obsidian.dev.evalJson(`(() => {
			[...document.querySelectorAll('.onePageInputModal button')].find(e => e.textContent === 'Cancel')?.click();
			delete window.__qaFocusResult;
			return true;
		})()`);
	}
});

it.each(["is-phone", "is-tablet"])("keeps the calendar month readable under %s host styles", async (deviceClass) => {
	const { obsidian } = getContext();
	try {
		await obsidian.dev.evalJson(`(() => {
			void app.plugins.plugins.quickadd.api.requestInputs([
				{ id: 'date', label: 'Date', type: 'date', defaultValue: '2026-09-19' },
			]).catch(() => undefined);
			return true;
		})()`);
		await waitForElement(obsidian, ".qa-date-picker__header");
		const layout = await obsidian.dev.evalJson<{
			labelWidth: number;
			labelFits: boolean;
			buttonWidths: number[];
			before: string;
			next: string;
			previous: string;
		}>(`(() => {
			const original = document.body.className;
			try {
				document.body.classList.remove('is-phone', 'is-tablet');
				document.body.classList.add('is-mobile', ${JSON.stringify(deviceClass)});
				const modal = document.querySelector('.onePageInputModal .modal');
				modal.style.width = '388px';
				const header = modal.querySelector('.qa-date-picker__header');
				const label = header.querySelector('.qa-date-picker__label');
				const before = label.textContent;
				const labelWidth = label.getBoundingClientRect().width;
				const labelFits = label.scrollWidth <= label.clientWidth;
				const buttonWidths = [...header.querySelectorAll('button')].map(e => e.getBoundingClientRect().width);
				header.querySelector('[aria-label="Next month"]').click();
				const next = label.textContent;
				header.querySelector('[aria-label="Previous month"]').click();
				return { labelWidth, labelFits, buttonWidths, before, next, previous: label.textContent };
			} finally { document.body.className = original; }
		})()`);
		expect(layout.labelWidth).toBeGreaterThan(80);
		expect(layout.labelFits).toBe(true);
		expect(layout.buttonWidths).toHaveLength(2);
		for (const width of layout.buttonWidths) {
			expect(width).toBeGreaterThanOrEqual(28);
			expect(width).toBeLessThanOrEqual(44);
		}
		expect(layout.next).not.toBe(layout.before);
		expect(layout.previous).toBe(layout.before);
	} finally {
		await obsidian.dev.evalJson(`(() => {
			const cancel = [...document.querySelectorAll('.onePageInputModal button')].find(e => e.textContent === 'Cancel');
			cancel?.click();
			return true;
		})()`);
	}
});
