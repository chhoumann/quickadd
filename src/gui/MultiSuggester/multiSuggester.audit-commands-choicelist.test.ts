import { beforeEach, describe, expect, it } from "vitest";
import { Modal, Notice } from "obsidian";

// The Modal stub calls `this.titleEl.setText(...)`; jsdom HTMLElement has no
// setText, so polyfill it before importing the suggester (mirrors how the real
// Obsidian DOM API augments HTMLElement). Other DOM helpers are already added by
// tests/vitest-setup.ts.
(HTMLElement.prototype as unknown as { setText?: unknown }).setText ??= function (
	this: HTMLElement,
	text: string,
) {
	this.textContent = text;
};

// The real Obsidian Modal defines onClose() (a no-op base) that subclasses call
// via super.onClose(); the stub omits it. Polyfill it so super.onClose() resolves.
(Modal.prototype as unknown as { onClose?: unknown }).onClose ??= function () {};

const MultiSuggester = (await import("./multiSuggester")).default;

function typeCustom(suggester: { contentEl: HTMLElement }, value: string) {
	const input = suggester.contentEl.querySelector<HTMLInputElement>(
		".qa-multi-custom-input",
	);
	if (!input) throw new Error("custom value input not found");
	input.value = value;
	input.dispatchEvent(new Event("input"));
	return input;
}

function clickButton(suggester: { contentEl: HTMLElement }, label: string) {
	const button = Array.from(
		suggester.contentEl.querySelectorAll("button"),
	).find((b) => b.textContent === label);
	if (!button) throw new Error(`button "${label}" not found`);
	button.click();
}

describe("MultiSuggester audit (commands-choicelist)", () => {
	beforeEach(() => {
		(Notice as unknown as { instances: unknown[] }).instances.length = 0;
	});

	it("folds a typed-but-not-Added custom value into the result on Done (data-loss fix)", async () => {
		const suggester = new MultiSuggester(
			{} as never,
			["A", "B"],
			["A", "B"],
			{ allowCustomValue: true },
		);

		// User types a custom value but clicks Done WITHOUT clicking Add.
		typeCustom(suggester, "Typed");
		clickButton(suggester, "Done");

		await expect(suggester.waitForClose).resolves.toEqual(["Typed"]);
	});

	it("commits a custom value on Enter in the custom field", async () => {
		const suggester = new MultiSuggester(
			{} as never,
			["A"],
			["A"],
			{ allowCustomValue: true },
		);

		const input = typeCustom(suggester, "ViaEnter");
		input.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);
		// After Enter the value is committed; Done should now resolve with it.
		clickButton(suggester, "Done");

		await expect(suggester.waitForClose).resolves.toEqual(["ViaEnter"]);
	});

	it("shows a Notice and does not add when the custom field is blank", async () => {
		const suggester = new MultiSuggester(
			{} as never,
			["A"],
			["A"],
			{ allowCustomValue: true },
		);

		typeCustom(suggester, "   ");
		clickButton(suggester, "Add");

		const messages = (
			Notice as unknown as { instances: { message: string }[] }
		).instances.map((n) => n.message);
		expect(messages).toContain("Enter a value to add.");

		clickButton(suggester, "Done");
		await expect(suggester.waitForClose).resolves.toEqual([]);
	});

	it("warns on a duplicate add of an already-selected custom value", async () => {
		const suggester = new MultiSuggester(
			{} as never,
			[],
			[],
			{ allowCustomValue: true },
		);

		typeCustom(suggester, "Dup");
		clickButton(suggester, "Add");
		// Type the same value again and Add — should warn, not duplicate.
		typeCustom(suggester, "Dup");
		clickButton(suggester, "Add");

		const messages = (
			Notice as unknown as { instances: { message: string }[] }
		).instances.map((n) => n.message);
		expect(messages).toContain('"Dup" is already added.');

		clickButton(suggester, "Done");
		await expect(suggester.waitForClose).resolves.toEqual(["Dup"]);
	});
});
