// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import {
	SuggesterInputSuggest,
	type SuggesterInputSuggestConfig,
	type SuggesterOption,
} from "./SuggesterInputSuggest";

const { logWarning } = vi.hoisted(() => ({ logWarning: vi.fn() }));
vi.mock("src/logger/logManager", () => ({ log: { logWarning, logError: vi.fn() } }));

function toOptions(labels: string[]): SuggesterOption[] {
	return labels.map((label, index) => ({ key: `opt:${index}`, value: `value-${index}`, label }));
}

function makeSuggest(labels: string[], config: Partial<SuggesterInputSuggestConfig> = {}) {
	const input = document.createElement("input");
	document.body.appendChild(input);
	const options = toOptions(labels);
	const onSelect = vi.fn();
	const suggest = new SuggesterInputSuggest(new App(), input, {
		getOptions: () => options,
		onSelect,
		...config,
	});
	return { suggest, input, options, onSelect };
}

const labelsOf = (options: SuggesterOption[]) => options.map((option) => option.label);
const companies = ["Aqua Carpatica", "Bank Stołeczny", "C", "Creative Labs", "Kawa Górska"];

describe("SuggesterInputSuggest ranking", () => {
	it("lists every option in list order for an empty query", () => {
		expect(labelsOf(makeSuggest(companies).suggest.getSuggestions(""))).toEqual(companies);
	});

	it("ranks an exact match, then prefixes, then the rest", () => {
		expect(labelsOf(makeSuggest(companies).suggest.getSuggestions("c"))).toEqual([
			"C",
			"Creative Labs",
			"Aqua Carpatica",
			"Bank Stołeczny",
		]);
	});

	it("honours caseSensitive", () => {
		expect(labelsOf(makeSuggest(companies, { caseSensitive: true }).suggest.getSuggestions("c"))).toEqual([
			"Aqua Carpatica",
			"Bank Stołeczny",
		]);
	});

	it("highlights the matched characters of a suggestion", () => {
		const { suggest } = makeSuggest(companies);
		const [match] = suggest.getSuggestions("carp");
		const el = document.createElement("div");
		suggest.renderSuggestion(match, el);
		expect(el.innerHTML).toBe('Aqua <mark class="qa-highlight">Carp</mark>atica');
	});

	it("treats a whole comma-bearing query as one search term", () => {
		const { suggest } = makeSuggest(["A string, with stuff after a comma", "Another string"], {
			multiSelect: true,
			allowCustomInput: false,
		});
		expect(labelsOf(suggest.getSuggestions("a string, with"))).toEqual(["A string, with stuff after a comma"]);
	});
});

describe("SuggesterInputSuggest single-select", () => {
	it("shows the picked label and reports the option", () => {
		const { suggest, input, options, onSelect } = makeSuggest(["Low", "High"]);
		suggest.selectSuggestion(options[1]);
		expect(input.value).toBe("High");
		expect(onSelect).toHaveBeenCalledWith(options[1]);
	});

	it("never offers a custom row", () => {
		expect(labelsOf(makeSuggest(["Low"]).suggest.getSuggestions("Urgent"))).toEqual([]);
	});
});

describe("SuggesterInputSuggest multi-select", () => {
	it("leaves picked options out of the list", () => {
		const picked = new Set(["opt:3"]);
		const { suggest } = makeSuggest(companies, { multiSelect: true, isSelected: (option) => picked.has(option.key) });
		expect(labelsOf(suggest.getSuggestions(""))).toEqual(["Aqua Carpatica", "Bank Stołeczny", "C", "Kawa Górska"]);
	});

	it("reports the exact option of each pick, so 'a' then 'b' differs from one option named 'a, b'", () => {
		const { suggest, input, options, onSelect } = makeSuggest(["a", "b", "a, b"], { multiSelect: true });
		suggest.selectSuggestion(options[0]);
		suggest.selectSuggestion(options[1]);
		expect(onSelect.mock.calls.map(([option]) => option)).toEqual([options[0], options[1]]);
		expect(input.value).toBe("");
	});

	it("offers to add typed text after the matches", () => {
		const { suggest } = makeSuggest(["client", "conference"], { multiSelect: true });
		const suggestions = suggest.getSuggestions("c");
		expect(labelsOf(suggestions)).toEqual(["client", "conference", "c"]);
		expect(suggestions.at(-1)).toMatchObject({ value: "c", isCustom: true });
	});

	it("puts a comma-bearing custom entry first when nothing matches it", () => {
		const { suggest } = makeSuggest(["Another string"], { multiSelect: true });
		expect(suggest.getSuggestions("A string, with stuff after a comma")).toEqual([
			{
				key: "custom:A string, with stuff after a comma",
				value: "A string, with stuff after a comma",
				label: "A string, with stuff after a comma",
				isCustom: true,
			},
		]);
	});

	it("does not offer to add an option's own label or a custom entry already picked", () => {
		const { suggest } = makeSuggest(["Client"], {
			multiSelect: true,
			isSelected: (option) => option.key === "custom:vip",
		});
		expect(labelsOf(suggest.getSuggestions("client"))).toEqual(["Client"]);
		expect(suggest.getSuggestions("vip")).toEqual([]);
	});

	it("offers no custom row when custom input is off", () => {
		const { suggest } = makeSuggest(["client"], { multiSelect: true, allowCustomInput: false });
		expect(labelsOf(suggest.getSuggestions("c"))).toEqual(["client"]);
		expect(suggest.getSuggestions("vip")).toEqual([]);
	});

	it("renders the custom row as an add action", () => {
		const { suggest } = makeSuggest([], { multiSelect: true });
		const [custom] = suggest.getSuggestions("vip");
		const el = document.createElement("div");
		suggest.renderSuggestion(custom, el);
		expect(el.querySelector(".suggestion-content")?.textContent).toBe("Add “vip”");
	});

	it("picks the top suggestion on Enter before the popup opens and detaches on destroy", () => {
		const { suggest, input, options, onSelect } = makeSuggest(["client", "conference"], { multiSelect: true });
		input.value = "cli";
		const enter = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
		input.dispatchEvent(enter);
		expect(enter.defaultPrevented).toBe(true);
		expect(onSelect).toHaveBeenCalledWith(options[0]);
		expect(input.value).toBe("");

		input.value = "con";
		const modEnter = new KeyboardEvent("keydown", { key: "Enter", metaKey: true, cancelable: true });
		input.dispatchEvent(modEnter);
		expect(modEnter.defaultPrevented).toBe(false);
		expect(onSelect).toHaveBeenCalledTimes(1);

		suggest.destroy();
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
		expect(onSelect).toHaveBeenCalledTimes(1);
	});
});

describe("SuggesterInputSuggest renderOption", () => {
	it("renders option rows with the caller's renderer", () => {
		const renderOption = vi.fn((value: string, el: HTMLElement) => {
			el.textContent = `custom ${value}`;
		});
		const { suggest, options } = makeSuggest(["Ada"], { renderOption });
		const el = document.createElement("div");
		suggest.renderSuggestion(options[0], el);
		expect(el.textContent).toBe("custom value-0");
	});

	it("falls back to the label, warning once, when the renderer throws", () => {
		logWarning.mockClear();
		const { suggest, options } = makeSuggest(["Ada", "Grace"], {
			renderOption: (_value, el) => {
				el.textContent = "partial";
				throw new Error("boom");
			},
		});
		const rows = options.map((option) => {
			const el = document.createElement("div");
			suggest.renderSuggestion(option, el);
			return el.textContent;
		});
		expect(rows).toEqual(["Ada", "Grace"]);
		expect(logWarning).toHaveBeenCalledTimes(1);
	});
});
