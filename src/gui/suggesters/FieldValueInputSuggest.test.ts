import type { App } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	FIELD_MULTI_VALUES_DATA_KEY,
	FieldValueInputSuggest,
} from "./FieldValueInputSuggest";

const mocks = vi.hoisted(() => ({
	collectFieldValuesProcessed: vi.fn(),
	renderMatch: vi.fn(),
}));

vi.mock("src/utils/FieldValueCollector", () => ({
	collectFieldValuesProcessed: mocks.collectFieldValuesProcessed,
}));

vi.mock("./suggest", () => ({
	TextInputSuggest: class {
		protected app: App;
		protected inputEl: HTMLInputElement;

		constructor(app: App, inputEl: HTMLInputElement) {
			this.app = app;
			this.inputEl = inputEl;
		}

		protected renderMatch(el: HTMLElement, item: string, query: string) {
			mocks.renderMatch(el, item, query);
		}

		protected getCurrentQuery() {
			return this.inputEl.value;
		}

		protected close() {}
	},
}));

describe("FieldValueInputSuggest", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.collectFieldValuesProcessed.mockResolvedValue([
			"Alice",
			"Bob",
			"Carol",
		]);
	});

	it("filters multi-select suggestions by the active term and excludes selected values", async () => {
		const input = document.createElement("input");
		const suggest = new FieldValueInputSuggest({} as App, input, "person|multi");

		await expect(suggest.getSuggestions("Alice, B")).resolves.toEqual(["Bob"]);
		expect(input.getAttribute("aria-multiselectable")).toBe("true");
	});

	it("highlights multi-select suggestions with only the active term", () => {
		const input = document.createElement("input");
		input.value = "Alice, B";
		const suggest = new FieldValueInputSuggest({} as App, input, "person|multi");
		const el = document.createElement("div");

		suggest.renderSuggestion("Bob", el);

		expect(mocks.renderMatch).toHaveBeenCalledWith(el, "Bob", "B");
	});

	it("stores exact selected multi values separately from the comma-delimited display text", async () => {
		mocks.collectFieldValuesProcessed.mockResolvedValue(["Doe, Jane", "Alice"]);
		const input = document.createElement("input");
		const suggest = new FieldValueInputSuggest({} as App, input, "person|multi");
		await suggest.getSuggestions("");

		suggest.selectSuggestion("Doe, Jane");

		expect(input.value).toBe("Doe, Jane, ");
		expect(input.dataset[FIELD_MULTI_VALUES_DATA_KEY]).toBe(
			JSON.stringify(["Doe, Jane"]),
		);
	});
});
