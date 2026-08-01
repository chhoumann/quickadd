import { describe, expect, it, vi } from "vitest";
import SearchableMultiSelect, {
	type SearchableMultiSelectItem,
} from "./searchableMultiSelect";

type Item = SearchableMultiSelectItem<string>;

function createPicker(
	items: Item[],
	initiallySelected: string[] = [],
): {
	container: HTMLDivElement;
	picker: SearchableMultiSelect<string>;
	selected: Set<string>;
} {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const selected = new Set(initiallySelected);
	const picker = new SearchableMultiSelect(container, {
		items,
		isSelected: (item) => selected.has(item.key),
		onToggle: (item, value) => {
			if (value) selected.add(item.key);
			else selected.delete(item.key);
		},
	});
	return { container, picker, selected };
}

function optionLabels(container: HTMLElement): string[] {
	return Array.from(
		container.querySelectorAll<HTMLElement>(
			".qa-searchable-multi-select__option-label",
		),
	).map((element) => element.textContent ?? "");
}

function search(container: HTMLElement, value: string): void {
	const input = container.querySelector<HTMLInputElement>(
		".qa-searchable-multi-select__search",
	);
	if (!input) throw new Error("search input not found");
	input.value = value;
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("SearchableMultiSelect", () => {
	it("keeps selected state while filtering and restores it when the filter clears", () => {
		const { container, selected } = createPicker(
			[
				{ key: "alpha", value: "a", label: "Alpha" },
				{ key: "beta", value: "b", label: "Beta" },
			],
			["beta"],
		);

		search(container, "alpha");
		expect(optionLabels(container)).toEqual(["Alpha"]);
		expect(selected).toEqual(new Set(["beta"]));

		search(container, "");
		const checkboxes = container.querySelectorAll<HTMLInputElement>(
			".qa-searchable-multi-select__option input[type=checkbox]",
		);
		expect(checkboxes[1].checked).toBe(true);
	});

	it("uses locale-independent case folding for ASCII search", () => {
		const localeLowerCase = vi
			.spyOn(String.prototype, "toLocaleLowerCase")
			.mockImplementation(function (this: string) {
				return this.replaceAll("I", "ı").toLowerCase();
			});

		try {
			const { container } = createPicker([
				{ key: "inbox", value: "inbox", label: "INBOX" },
			]);

			search(container, "i");
			expect(optionLabels(container)).toEqual(["INBOX"]);
			expect(localeLowerCase).not.toHaveBeenCalled();
		} finally {
			localeLowerCase.mockRestore();
		}
	});

	it("uses the whole labelled row as the native checkbox target", () => {
		const { container, selected } = createPicker([
			{ key: "alpha", value: "a", label: "Alpha" },
		]);

		container
			.querySelector<HTMLLabelElement>(".qa-searchable-multi-select__option")
			?.click();

		expect(selected.has("alpha")).toBe(true);
	});

	it("does not autofocus the search field when a mobile modal opens", () => {
		const { container, picker } = createPicker([
			{ key: "alpha", value: "a", label: "Alpha" },
		]);
		const input = container.querySelector<HTMLInputElement>(
			".qa-searchable-multi-select__search",
		);
		if (!input) throw new Error("search input not found");

		document.body.classList.add("is-mobile");
		try {
			picker.focusSearchOnOpen();
			expect(document.activeElement).not.toBe(input);
		} finally {
			document.body.classList.remove("is-mobile");
		}

		picker.focusSearchOnOpen();
		expect(document.activeElement).toBe(input);
	});

	it("selects and removes options with Arrow keys and Enter or Space", () => {
		const { container, selected } = createPicker([
			{ key: "alpha", value: "a", label: "Alpha" },
			{ key: "beta", value: "b", label: "Beta" },
		]);
		const input = container.querySelector<HTMLInputElement>(
			".qa-searchable-multi-select__search",
		);
		if (!input) throw new Error("search input not found");
		input.focus();
		input.dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
		);

		const first = container.querySelectorAll<HTMLInputElement>(
			".qa-searchable-multi-select__option input[type=checkbox]",
		)[0];
		expect(document.activeElement).toBe(first);
		first.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);
		expect(selected.has("alpha")).toBe(true);

		first.dispatchEvent(
			new KeyboardEvent("keydown", { key: " ", bubbles: true }),
		);
		expect(selected.has("alpha")).toBe(false);
	});

	it("keeps duplicate labels independent and synchronizes duplicate values by key", () => {
		const { container, selected } = createPicker([
			{ key: "first", value: "first", label: "Duplicate" },
			{ key: "second", value: "second", label: "Duplicate" },
			{ key: "shared", value: "shared", label: "Shared one" },
			{ key: "shared", value: "shared", label: "Shared two" },
		]);
		const rows = container.querySelectorAll<HTMLLabelElement>(
			".qa-searchable-multi-select__option",
		);

		rows[1].click();
		expect(selected).toEqual(new Set(["second"]));

		rows[2].click();
		const checkboxes = container.querySelectorAll<HTMLInputElement>(
			".qa-searchable-multi-select__option input[type=checkbox]",
		);
		expect(checkboxes[2].checked).toBe(true);
		expect(checkboxes[3].checked).toBe(true);
	});

	it("renders a useful empty state and disables search for an empty list", () => {
		const { container } = createPicker([]);
		expect(
			container.querySelector(".qa-searchable-multi-select__empty"),
		).toHaveTextContent("No options available");
		expect(
			container.querySelector<HTMLInputElement>(
				".qa-searchable-multi-select__search",
			),
		).toBeDisabled();
	});

	it("keeps the complete long label in the accessible row", () => {
		const label =
			"A deliberately long option label that must remain readable on narrow screens";
		const { container } = createPicker([
			{ key: "long", value: "long", label },
		]);
		const row = container.querySelector<HTMLLabelElement>(
			".qa-searchable-multi-select__option",
		);
		expect(row).toHaveTextContent(label);
		expect(row?.querySelector("input")).toHaveAttribute("type", "checkbox");
	});

	it("caps large result sets while keeping a selected item visible", () => {
		const items = Array.from({ length: 500 }, (_, index) => ({
			key: String(index),
			value: String(index),
			label: `Option ${index}`,
		}));
		const { container } = createPicker(items, ["499"]);

		expect(
			container.querySelectorAll(".qa-searchable-multi-select__option"),
		).toHaveLength(200);
		expect(optionLabels(container)).toContain("Option 499");
		expect(
			container.querySelector(".qa-searchable-multi-select__limit"),
		).toHaveTextContent("Showing 200 of 500 options");
	});
});
