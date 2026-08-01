import { describe, it, expect } from "vitest";
import { Modal } from "obsidian";
import { UserCancelError } from "../../errors/UserCancelError";

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

function search(suggester: { contentEl: HTMLElement }, value: string): void {
	const input = suggester.contentEl.querySelector<HTMLInputElement>(
		".qa-searchable-multi-select__search",
	);
	if (!input) throw new Error("search input not found");
	input.value = value;
	input.dispatchEvent(new Event("input", { bubbles: true }));
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

	it("preserves preselection while filtering and returns source order", async () => {
		const suggester = new MultiSuggester(
			{} as never,
			["Alpha", "Beta", "Gamma"],
			["alpha", "beta", "gamma"],
			{ preselected: ["gamma"] },
		);
		search(suggester, "alpha");
		const [alpha] = listCheckboxes(suggester);
		alpha.click();
		clickButton(suggester, "Done");

		await expect(suggester.waitForClose).resolves.toEqual(["alpha", "gamma"]);
	});

	it("keeps duplicate labels independent and duplicate values synchronized", async () => {
		const suggester = new MultiSuggester(
			{} as never,
			["Duplicate", "Duplicate", "Shared one", "Shared two"],
			["first", "second", "shared", "shared"],
		);
		const checkboxes = listCheckboxes(suggester);
		checkboxes[1].click();
		checkboxes[2].click();

		expect(checkboxes[0].checked).toBe(false);
		expect(checkboxes[1].checked).toBe(true);
		expect(checkboxes[2].checked).toBe(true);
		expect(checkboxes[3].checked).toBe(true);
		clickButton(suggester, "Done");
		await expect(suggester.waitForClose).resolves.toEqual([
			"second",
			"shared",
			"shared",
		]);
	});

	it("keeps cancellation distinct from an empty Done submission", async () => {
		const cancelled = new MultiSuggester({} as never, [], []);
		clickButton(cancelled, "Cancel");
		await expect(cancelled.waitForClose).rejects.toBeInstanceOf(UserCancelError);

		const submitted = new MultiSuggester({} as never, [], []);
		clickButton(submitted, "Done");
		await expect(submitted.waitForClose).resolves.toEqual([]);
	});
});
