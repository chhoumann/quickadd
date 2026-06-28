import { describe, it, expect } from "vitest";
import { Modal } from "obsidian";

// Mirror the polyfills the sibling MultiSuggester test installs: the Modal stub
// calls titleEl.setText and subclasses call super.onClose().
(HTMLElement.prototype as unknown as { setText?: unknown }).setText ??= function (
	this: HTMLElement,
	text: string,
) {
	this.textContent = text;
};
(Modal.prototype as unknown as { onClose?: unknown }).onClose ??= function () {};

const MultiSuggester = (await import("./multiSuggester")).default;

function clickButton(suggester: { contentEl: HTMLElement }, label: string) {
	const button = Array.from(
		suggester.contentEl.querySelectorAll("button"),
	).find((b) => b.textContent === label);
	if (!button) throw new Error(`button "${label}" not found`);
	button.click();
}

function listCheckboxes(suggester: { contentEl: HTMLElement }) {
	const list = suggester.contentEl.querySelector(".qa-multi-list");
	if (!list) throw new Error("multi list not found");
	return Array.from(list.querySelectorAll<HTMLInputElement>("input[type=checkbox]"));
}

describe("MultiSuggester preselection (issue #1429)", () => {
	it("resolves preselected option-list values on Done with no interaction", async () => {
		const suggester = new MultiSuggester(
			{} as never,
			["Alpha", "Beta", "Gamma"],
			["Alpha", "Beta", "Gamma"],
			{ preselected: ["Beta"] },
		);

		clickButton(suggester, "Done");
		await expect(suggester.waitForClose).resolves.toEqual(["Beta"]);
	});

	it("preselects values not in the option list as pre-checked custom rows", async () => {
		const suggester = new MultiSuggester(
			{} as never,
			["Alpha"],
			["Alpha"],
			{ allowCustomValue: true, preselected: ["Zeta"] },
		);

		clickButton(suggester, "Done");
		await expect(suggester.waitForClose).resolves.toEqual(["Zeta"]);
	});

	it("returns option values in option order, then custom preselections", async () => {
		const suggester = new MultiSuggester(
			{} as never,
			["Alpha", "Beta", "Gamma"],
			["Alpha", "Beta", "Gamma"],
			{ allowCustomValue: true, preselected: ["Gamma", "Alpha", "Zeta"] },
		);

		clickButton(suggester, "Done");
		await expect(suggester.waitForClose).resolves.toEqual([
			"Alpha",
			"Gamma",
			"Zeta",
		]);
	});

	it("ignores blank/whitespace preselected entries", async () => {
		const suggester = new MultiSuggester(
			{} as never,
			["Alpha", "Beta"],
			["Alpha", "Beta"],
			{ preselected: ["", "  ", "Beta"] },
		);

		clickButton(suggester, "Done");
		await expect(suggester.waitForClose).resolves.toEqual(["Beta"]);
	});

	it("lets the user deselect a preselected value", async () => {
		const suggester = new MultiSuggester(
			{} as never,
			["Alpha", "Beta"],
			["Alpha", "Beta"],
			{ preselected: ["Alpha"] },
		);

		// Uncheck the first row (Alpha).
		const [alphaToggle] = listCheckboxes(suggester);
		alphaToggle.checked = false;
		alphaToggle.dispatchEvent(new Event("change"));

		clickButton(suggester, "Done");
		await expect(suggester.waitForClose).resolves.toEqual([]);
	});

	it("preselects nothing when the option is absent (no crash)", async () => {
		const suggester = new MultiSuggester(
			{} as never,
			["Alpha", "Beta"],
			["Alpha", "Beta"],
			{ preselected: [] },
		);

		clickButton(suggester, "Done");
		await expect(suggester.waitForClose).resolves.toEqual([]);
	});
});
