import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import {
	FilePickerInputSuggest,
	type FilePickerOption,
} from "./FilePickerInputSuggest";

const options: FilePickerOption[] = [
	{
		value: "@file:People/Ada.md",
		label: "Ada Lovelace",
		path: "People/Ada.md",
	},
	{
		value: "@file:Archive/Grace.md",
		label: "Grace Hopper",
		path: "Archive/Grace.md",
	},
];

function createSuggest(
	selected = new Set<string>(),
	allowCustomInput = false,
	multiSelect = false,
) {
	const input = document.createElement("input");
	document.body.appendChild(input);
	const onSelect = vi.fn();
	const app = {
		dom: { appContainerEl: document.body },
		keymap: { pushScope: vi.fn(), popScope: vi.fn() },
	} as unknown as App;
	const suggest = new FilePickerInputSuggest(
		app,
		input,
		() => options,
		(value) => selected.has(value),
		onSelect,
		multiSelect,
		allowCustomInput,
	);
	return { input, onSelect, suggest };
}

describe("FilePickerInputSuggest", () => {
	it("searches both display labels and full paths", () => {
		const { suggest } = createSuggest();
		expect(suggest.getSuggestions("Ada")).toEqual([options[0]]);
		expect(suggest.getSuggestions("Archive")).toEqual([options[1]]);
		suggest.destroy();
	});

	it("excludes selected files from the results", () => {
		const { suggest } = createSuggest(new Set([options[0].value]));
		expect(suggest.getSuggestions("")).toEqual([options[1]]);
		suggest.destroy();
	});

	it("offers a literal custom value only when custom input is enabled", () => {
		const { suggest } = createSuggest(new Set(), true);
		expect(suggest.getSuggestions("New person")[0]).toEqual({
			value: "New person",
			label: "Use “New person”",
			path: "Custom value",
			isCustom: true,
		});
		suggest.destroy();

		const withoutCustom = createSuggest().suggest;
		expect(withoutCustom.getSuggestions("New person")).toEqual([]);
		withoutCustom.destroy();
	});

	it("offers a typed new note's name as Create new note, with the file-plus icon", () => {
		const input = document.createElement("input");
		const app = {
			dom: { appContainerEl: document.body },
			keymap: { pushScope: vi.fn(), popScope: vi.fn() },
		} as unknown as App;
		const suggest = new FilePickerInputSuggest(app, input, () => options, () => false, vi.fn(), false, true, () => false);
		const [created] = suggest.getSuggestions("Niobe");
		expect(created).toMatchObject({ value: "Niobe", label: "Create new note: Niobe", isCustom: true });
		const row = document.createElement("div");
		suggest.renderSuggestion(created, row);
		expect(row.querySelector(".qa-onepage-file-suggestion__label")?.textContent).toBe("Create new note: Niobe");
		expect(row.querySelector(".qa-onepage-file-suggestion__path")).toBeNull();
		expect(row.querySelector(".suggestion-aux .suggestion-flair")).not.toBeNull();
		suggest.destroy();
	});

	it("picks a file by its name, label, path or alias rather than offering it as a custom value", () => {
		const titled: FilePickerOption = {
			value: "People/Thomas Anderson.md",
			label: "The Matrix (Thomas Anderson)",
			path: "People/Thomas Anderson.md",
			aliases: ["Neo"],
		};
		const input = document.createElement("input");
		const app = {
			dom: { appContainerEl: document.body },
			keymap: { pushScope: vi.fn(), popScope: vi.fn() },
		} as unknown as App;
		const suggest = new FilePickerInputSuggest(app, input, () => [titled], () => false, vi.fn(), false, true);
		for (const typed of ["thomas anderson", "The Matrix (Thomas Anderson)", "people/thomas anderson.md", "NEO"]) {
			expect(suggest.getSuggestions(typed).some((option) => option.isCustom)).toBe(false);
		}
		expect(suggest.getSuggestions("Niobe")[0]?.isCustom).toBe(true);
		suggest.destroy();
	});

	it("returns the exact encoded path and clears the multi-select search", () => {
		const { input, onSelect, suggest } = createSuggest(new Set(), false, true);
		input.value = "Grace";
		suggest.selectSuggestion(options[1]);
		expect(onSelect).toHaveBeenCalledWith(options[1]);
		expect(input.value).toBe("");
		suggest.destroy();
	});
});
