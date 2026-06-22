import { beforeAll, describe, expect, it } from "vitest";
import { createDatePicker } from "./datePicker";

// createDatePicker renders into a real (jsdom) element and uses Obsidian's
// HTMLElement augmentations. createDiv/createEl/addClass/empty are polyfilled in
// the shared vitest setup; setAttr is not, so add a faithful local polyfill.
beforeAll(() => {
	const proto = HTMLElement.prototype as unknown as {
		setAttr?: (name: string, value: string) => void;
	};
	if (typeof proto.setAttr !== "function") {
		proto.setAttr = function setAttr(
			this: Element,
			name: string,
			value: string,
		) {
			this.setAttribute(name, value);
		};
	}
});

function findTimeInput(container: HTMLElement): HTMLInputElement {
	const input = container.querySelector<HTMLInputElement>(
		"input.qa-date-picker__time-input",
	);
	if (!input) throw new Error("time input not found");
	return input;
}

function clickDay(container: HTMLElement, day: string): void {
	const buttons = Array.from(
		container.querySelectorAll<HTMLButtonElement>(
			"button.qa-date-picker__day:not(.is-outside)",
		),
	);
	const target = buttons.find((b) => b.textContent === day);
	if (!target) throw new Error(`day button '${day}' not found`);
	target.dispatchEvent(new Event("click", { bubbles: true }));
}

describe("createDatePicker time-clearing (audit: prompts-gui-date-picker-time-control)", () => {
	it("drops the merged time back to midnight when the time field is cleared", () => {
		const container = document.createElement("div");
		const emitted: Array<string | null> = [];

		createDatePicker({
			container,
			initialIso: "2025-12-25T14:30:00",
			withTime: true,
			weekStartsOn: 0,
			onSelect: (iso) => emitted.push(iso),
		});

		const timeInput = findTimeInput(container);
		expect(timeInput.value).toBe("14:30");

		// Pick a day so there is a selection carrying the 14:30 time.
		clickDay(container, "10");
		expect(emitted.at(-1)).toBe("2025-12-10T14:30:00");

		// Clear the time field. Before the fix this returned early (NaN guard),
		// leaving currentTime = 14:30 so the next day pick re-applied it.
		timeInput.value = "";
		timeInput.dispatchEvent(new Event("change", { bubbles: true }));

		// Clearing re-emits the current selection at midnight.
		expect(emitted.at(-1)).toBe("2025-12-10T00:00:00");

		// Subsequent day picks must NOT resurrect the old 14:30 time.
		clickDay(container, "15");
		expect(emitted.at(-1)).toBe("2025-12-15T00:00:00");
	});

	it("still merges a newly typed time after clearing", () => {
		const container = document.createElement("div");
		const emitted: Array<string | null> = [];

		createDatePicker({
			container,
			initialIso: "2025-12-25T08:00:00",
			withTime: true,
			weekStartsOn: 0,
			onSelect: (iso) => emitted.push(iso),
		});

		clickDay(container, "5");
		expect(emitted.at(-1)).toBe("2025-12-05T08:00:00");

		const timeInput = findTimeInput(container);
		timeInput.value = "";
		timeInput.dispatchEvent(new Event("change", { bubbles: true }));
		expect(emitted.at(-1)).toBe("2025-12-05T00:00:00");

		timeInput.value = "09:15";
		timeInput.dispatchEvent(new Event("change", { bubbles: true }));
		expect(emitted.at(-1)).toBe("2025-12-05T09:15:00");
	});
});
