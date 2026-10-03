import { expect, it } from "vitest";
import type { ObsidianClient } from "obsidian-e2e";
import { createQuickAddE2EHarness } from "./e2eVault";
import { clickAt, DESCRIBE_ELEMENT, insertText, POLL_OPTS, pressKey, waitForElement } from "./uiHelpers";

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
		expect(await obsidian.dev.evalJson<string>(`(() => {
			${DESCRIBE_ELEMENT}
			const first = document.querySelector(".onePageInputModal input");
			return document.activeElement === first ? "first field" : describe(document.activeElement);
		})()`)).toBe("first field");
		await insertText(obsidian, "Native focus");
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

// Presses Tab until focus reaches `target` and returns every stop; a stop on
// the calendar or its toggle is prefixed "calendar". Whether the "Aliases" disclosure
// adds a stop depends on the vault's alias settings, so the tests allow it.
async function tabTo(obsidian: ObsidianClient, target: string): Promise<string[]> {
	const stops: string[] = [];
	while (stops.length < 3 && stops.at(-1) !== target) {
		await pressKey(obsidian, "Tab");
		stops.push(await obsidian.dev.evalJson<string>(`(() => {
			${DESCRIBE_ELEMENT}
			const el = document.activeElement;
			return (el.closest('.qa-date-picker, .qa-date-field__calendar') ? "calendar " : "") + describe(el);
		})()`));
	}
	return stops;
}

it("tabs from a form's date field past the calendar to the next field", async () => {
	const { obsidian } = getContext();
	try {
		await obsidian.dev.evalJson(`(() => {
			void app.plugins.plugins.quickadd.api.requestInputs([
				{ id: 'due', label: 'Due', type: 'date', withTime: true },
				{ id: 'title', label: 'Title', type: 'text', placeholder: 'Next field' },
			]).catch(() => undefined);
			return true;
		})()`);
		await waitForElement(obsidian, ".onePageInputModal .qa-date-picker");
		const stops = await tabTo(obsidian, 'input "Next field"');
		expect(stops.filter((stop) => stop.startsWith("calendar "))).toEqual([]);
		expect(stops.at(-1)).toBe('input "Next field"');
	} finally {
		await obsidian.dev.evalJson(`(() => {
			[...document.querySelectorAll('.onePageInputModal button')].find(e => e.textContent === 'Cancel')?.click();
			return true;
		})()`);
	}
});

it("tabs from the date prompt past the calendar to its actions", async () => {
	const { obsidian } = getContext();
	try {
		await obsidian.dev.evalJson(`(() => {
			void app.plugins.plugins.quickadd.api.datePrompt('due date').catch(() => undefined);
			return true;
		})()`);
		await waitForElement(obsidian, ".qaDatePrompt .qa-date-picker");
		const stops = await tabTo(obsidian, 'button.mod-cta "Ok"');
		expect(stops.filter((stop) => stop.startsWith("calendar "))).toEqual([]);
		expect(stops.at(-1)).toBe('button.mod-cta "Ok"');
	} finally {
		await obsidian.dev.evalJson(`(() => {
			[...document.querySelectorAll('.qaDatePrompt button')].find(e => e.textContent === 'Cancel')?.click();
			return true;
		})()`);
	}
});

const CALENDAR_STATE = `(() => {
	const toggle = document.querySelector('.qa-date-field__calendar');
	return {
		shown: document.querySelector('.qa-date-picker-container').getClientRects().length > 0,
		label: toggle.getAttribute('aria-label'),
		setting: app.plugins.plugins.quickadd.settings.showDateCalendar,
		typing: document.activeElement === document.querySelector('.qa-date-field input'),
	};
})()`;

async function clickCalendarToggle(obsidian: ObsidianClient) {
	const { x, y } = await obsidian.dev.evalJson<{ x: number; y: number }>(`(() => {
		const rect = document.querySelector('.qa-date-field__calendar').getBoundingClientRect();
		return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
	})()`);
	await clickAt(obsidian, x, y);
}

it("hides the calendar from the date field and remembers it for the next date prompt", async () => {
	const { obsidian } = getContext();
	try {
		await obsidian.dev.evalJson(`(() => {
			void app.plugins.plugins.quickadd.api.requestInputs([
				{ id: 'due', label: 'Due', type: 'date' },
			]).catch(() => undefined);
			return true;
		})()`);
		await waitForElement(obsidian, ".onePageInputModal .qa-date-picker");
		await clickCalendarToggle(obsidian);
		expect(await obsidian.dev.evalJson(CALENDAR_STATE)).toEqual({ shown: false, label: "Show calendar", setting: false, typing: true });
		await obsidian.dev.evalJson(`(() => {
			[...document.querySelectorAll('.onePageInputModal button')].find(e => e.textContent === 'Cancel')?.click();
			void app.plugins.plugins.quickadd.api.datePrompt('due date').catch(() => undefined);
			return true;
		})()`);
		await waitForElement(obsidian, ".qaDatePrompt .qa-date-field__calendar");
		expect(await obsidian.dev.evalJson(CALENDAR_STATE)).toEqual({ shown: false, label: "Show calendar", setting: false, typing: true });
		await clickCalendarToggle(obsidian);
		expect(await obsidian.dev.evalJson(CALENDAR_STATE)).toEqual({ shown: true, label: "Hide calendar", setting: true, typing: true });
	} finally {
		await obsidian.dev.evalJson(`(() => {
			document.querySelector('.qa-date-field__calendar[aria-pressed="false"]')?.click();
			[...document.querySelectorAll('.onePageInputModal button, .qaDatePrompt button')].find(e => e.textContent === 'Cancel')?.click();
			return true;
		})()`);
	}
});

// QuickAdd's dialogs get Obsidian's own dialog height; with less, the date
// prompt hides Ok and Cancel in an 800 px window (#1860). A bare modal stands
// in for core's dialogs.
it.each(["desktop", "is-phone"])("gives the date prompt Obsidian's dialog height under %s host styles", async (deviceClass) => {
	const { obsidian } = getContext();
	try {
		await obsidian.dev.evalJson(`(() => {
			void app.plugins.plugins.quickadd.api.datePrompt('due date').catch(() => undefined);
			return true;
		})()`);
		await waitForElement(obsidian, ".qaDatePrompt .modal");
		const caps = await obsidian.dev.evalJson<{ prompt: string; core: string }>(`(() => {
			const original = document.body.className;
			const core = document.body.createDiv({ cls: "modal-container" }).createDiv({ cls: "modal" });
			try {
				if (${JSON.stringify(deviceClass)} === 'is-phone') {
					document.body.classList.remove('is-tablet');
					document.body.classList.add('is-mobile', 'is-phone');
				}
				return {
					prompt: getComputedStyle(document.querySelector('.qaDatePrompt .modal')).maxHeight,
					core: getComputedStyle(core).maxHeight,
				};
			} finally {
				document.body.className = original;
				core.parentElement.remove();
			}
		})()`);
		expect(caps.core).toMatch(/px$/);
		expect(caps.prompt).toBe(caps.core);
	} finally {
		await obsidian.dev.evalJson(`(() => {
			[...document.querySelectorAll('.qaDatePrompt button')].find(e => e.textContent === 'Cancel')?.click();
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

// The preview sat 36 px above Ok/Cancel while every other gap in the prompt is
// 16 px: its own margin, the flex column's gap and the actions' margin added up.
it("spaces the date prompt's actions from the preview like the preview from the calendar", async () => {
	const { obsidian } = getContext();
	try {
		await obsidian.dev.evalJson(`(() => {
			void app.plugins.plugins.quickadd.api.datePrompt('due date').catch(() => undefined);
			return true;
		})()`);
		await waitForElement(obsidian, ".qaDatePrompt .vdate-preview-container");
		const gaps = await obsidian.dev.evalJson<{ calendarToPreview: number; previewToActions: number }>(`(() => {
			const prompt = document.querySelector('.qaDatePrompt');
			const rect = (selector) => prompt.querySelector(selector).getBoundingClientRect();
			const calendar = rect('.qa-date-picker-container');
			const preview = rect('.vdate-preview-container');
			const actions = rect('.qa-prompt-actions');
			return { calendarToPreview: preview.top - calendar.bottom, previewToActions: actions.top - preview.bottom };
		})()`);
		expect(gaps.calendarToPreview).toBeGreaterThan(0);
		expect(gaps.previewToActions).toBeCloseTo(gaps.calendarToPreview, 0);
	} finally {
		await obsidian.dev.evalJson(`(() => {
			[...document.querySelectorAll('.qaDatePrompt button')].find(e => e.textContent === 'Cancel')?.click();
			return true;
		})()`);
	}
});
