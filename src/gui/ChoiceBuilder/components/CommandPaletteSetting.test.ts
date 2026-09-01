import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/svelte";
import { flushSync } from "svelte";
import CommandPaletteSetting from "./CommandPaletteSetting.svelte";
import type { DateOrigin } from "../../../types/dateOrigin";

function settingNames(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll(".setting-item-name")).map(
		(el) => el.textContent ?? "",
	);
}

function mount(input: {
	command: boolean;
	pickDayCommand?: boolean;
	dateOrigin?: DateOrigin;
}) {
	return render(CommandPaletteSetting, {
		props: {
			command: input.command,
			pickDayCommand: input.pickDayCommand,
			name: "Daily note",
			dateOrigin: input.dateOrigin,
		},
	});
}

describe("CommandPaletteSetting", () => {
	it("hides the pick-a-day option until the choice is a command", () => {
		const { container } = mount({ command: false });
		expect(settingNames(container)).toEqual(["Add to command palette"]);
	});

	it("shows the pick-a-day option with the live command name", () => {
		const { container } = mount({ command: true });
		expect(settingNames(container)).toEqual([
			"Add to command palette",
			'Also add "Daily note (pick a day)"',
		]);
	});

	it("hides the pick-a-day option for Ask each time", () => {
		const { container } = mount({
			command: true,
			dateOrigin: { kind: "ask" },
		});
		expect(settingNames(container)).toEqual(["Add to command palette"]);
	});

	it("reveals the pick-a-day option when the command toggle flips on", async () => {
		const { container } = mount({ command: false });
		const toggle = container.querySelector<HTMLElement>(
			'[role="switch"][aria-label="Add to command palette"]',
		);
		if (!toggle) throw new Error("command toggle not found");

		await fireEvent.click(toggle);
		flushSync();

		expect(toggle.getAttribute("aria-checked")).toBe("true");
		expect(settingNames(container)).toContain(
			'Also add "Daily note (pick a day)"',
		);
	});
});
