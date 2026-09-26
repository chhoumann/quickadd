import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "src/settings";
import { settingsStore } from "src/settingsStore";
import { deepClone } from "src/utils/deepClone";
import { providerEntryNames } from "./aiSettingsState";

describe("providerEntryNames", () => {
	beforeEach(() => settingsStore.replaceState(deepClone(DEFAULT_SETTINGS)));

	it("passes unique names through and labels blank providers", () => {
		expect(providerEntryNames([
			{ id: "a", name: "Alpha" },
			{ id: "blank", name: "  " },
		])).toEqual(["Alpha", "Untitled provider"]);
	});

	it("qualifies duplicate names with stable ids", () => {
		expect(providerEntryNames([
			{ id: "work", name: "OpenAI" },
			{ id: "home", name: "OpenAI" },
		])).toEqual(["OpenAI (work)", "OpenAI (home)"]);
	});

	it("always produces unique entries for adversarial names", () => {
		const result = providerEntryNames([
			{ id: "a", name: "A" },
			{ id: "b", name: "A" },
			{ id: "c", name: "A (a)" },
			{ id: "d", name: "" },
			{ id: "e", name: "" },
		]);

		expect(result).toHaveLength(5);
		expect(new Set(result).size).toBe(5);
		expect(result.slice(0, 3)).toEqual(["A (a)", "A (b)", "A (a) (2)"]);
	});
});
