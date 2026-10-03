import { describe, expect, it } from "vitest";
import { Modal } from "obsidian";

// The Modal stub calls titleEl.setText and subclasses call super.onClose().
(HTMLElement.prototype as unknown as { setText?: unknown }).setText ??= function (
	this: HTMLElement,
	text: string,
) {
	this.textContent = text;
};
(Modal.prototype as unknown as { onClose?: unknown }).onClose ??= function () {};

const MultiSuggester = (await import("./multiSuggester")).default;

const labels = ["Thomas Anderson", "Neo Classic"];
const values = ["!pick:People/Thomas Anderson.md", "!pick:People/Neo Classic.md"];
const aliases = [["Neo", "The One"], []];

function open() {
	return new MultiSuggester({} as never, labels, values, { aliases });
}

function search(suggester: { contentEl: HTMLElement }, value: string) {
	const input = suggester.contentEl.querySelector<HTMLInputElement>(
		".qa-searchable-multi-select__search",
	);
	if (!input) throw new Error("search input not found");
	input.value = value;
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

function rows(suggester: { contentEl: HTMLElement }) {
	return Array.from(
		suggester.contentEl.querySelectorAll(".qa-searchable-multi-select__option"),
		(row) => ({
			title: row.querySelector(".qa-searchable-multi-select__option-label")?.textContent,
			note: row.querySelector(".qa-searchable-multi-select__option-note")?.textContent ?? "",
			alias: Boolean(row.querySelector('[aria-label="Alias"]')),
		}),
	);
}

describe("MultiSuggester with aliases", () => {
	it("shows the alias that found a note, with the note's name beneath", () => {
		const suggester = open();
		search(suggester, "the one");
		expect(rows(suggester)).toEqual([
			{ title: "The One", note: "Thomas Anderson", alias: true },
		]);

		search(suggester, "neo");
		expect(rows(suggester)).toEqual([
			{ title: "Neo", note: "Thomas Anderson", alias: true },
			{ title: "Neo Classic", note: "", alias: false },
		]);
	});

	it("shows a note found by its own name as usual", () => {
		const suggester = open();
		search(suggester, "thomas");
		expect(rows(suggester)).toEqual([
			{ title: "Thomas Anderson", note: "", alias: false },
		]);
	});

	it("checks the note itself from its alias row", async () => {
		const suggester = open();
		search(suggester, "the one");
		suggester.contentEl.querySelector<HTMLInputElement>("input[type=checkbox]")?.click();
		Array.from(suggester.contentEl.querySelectorAll("button"))
			.find((button) => button.textContent === "Done")
			?.click();
		await expect(suggester.waitForClose).resolves.toEqual([values[0]]);
	});

	it("checks the note whose alias is typed as a custom value", async () => {
		const suggester = new MultiSuggester({} as never, labels, values, { aliases, allowCustomValue: true });
		const custom = suggester.contentEl.querySelector<HTMLInputElement>(".qa-multi-custom-input");
		if (!custom) throw new Error("custom value field not found");
		custom.value = "the one";
		custom.dispatchEvent(new Event("input", { bubbles: true }));
		custom.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
		// Typed again and folded in on Done: still the note, once.
		const again = suggester.contentEl.querySelector<HTMLInputElement>(".qa-multi-custom-input");
		if (!again) throw new Error("custom value field not found");
		again.value = "NEO";
		again.dispatchEvent(new Event("input", { bubbles: true }));
		Array.from(suggester.contentEl.querySelectorAll("button"))
			.find((button) => button.textContent === "Done")
			?.click();
		await expect(suggester.waitForClose).resolves.toEqual([values[0]]);
	});
});
