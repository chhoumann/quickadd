import { describe, expect, it, vi } from "vitest";

// runOnePagePreflight transitively imports src/main and obsidian-dataview; mock
// the heavy deps so we can import the pure exported helper under test.
vi.mock("src/quickAddSettingsTab", () => ({
	QuickAddSettingsTab: class {},
}));

vi.mock("src/main", () => ({
	__esModule: true,
	default: class QuickAddMock {},
}));

vi.mock("obsidian-dataview", () => ({
	__esModule: true,
	getAPI: vi.fn().mockReturnValue(null),
}));

import { splitMultiSelectLabels } from "./runOnePagePreflight";

// Finding: prompts-gui-multi-suggester — the one-page |multi field stores a
// ", "-joined string of DISPLAY labels. A naive split(",") loses options whose
// value/label contains a literal comma (#239 quoted-comma option list). The
// reconstruction must round-trip comma-bearing labels.
describe("splitMultiSelectLabels", () => {
	it("round-trips comma-bearing option labels (issue #239)", () => {
		const displayToValue = new Map<string, string>([
			["a, b", "a, b"],
			["c, d", "c, d"],
		]);

		// Suggester joins the two picks with ", " -> "a, b, c, d".
		expect(splitMultiSelectLabels("a, b, c, d", displayToValue)).toEqual([
			"a, b",
			"c, d",
		]);
	});

	it("splits ordinary comma-free labels exactly like before", () => {
		const displayToValue = new Map<string, string>([
			["red", "red"],
			["green", "green"],
			["blue", "blue"],
		]);

		expect(
			splitMultiSelectLabels("red, green, blue", displayToValue),
		).toEqual(["red", "green", "blue"]);
	});

	it("falls back to a comma split for typed custom text not in the option map", () => {
		const displayToValue = new Map<string, string>([["red", "red"]]);

		// "red" is a known label; "custom" is typed text -> still captured.
		expect(splitMultiSelectLabels("red, custom", displayToValue)).toEqual([
			"red",
			"custom",
		]);
	});

	it("returns an empty array for a blank string", () => {
		expect(splitMultiSelectLabels("", new Map())).toEqual([]);
	});

	it("prefers the longest matching label when labels share a prefix", () => {
		const displayToValue = new Map<string, string>([
			["a", "a"],
			["a, b", "a, b"],
		]);

		// Greedy longest-first match keeps "a, b" intact instead of ["a","b"].
		expect(splitMultiSelectLabels("a, b", displayToValue)).toEqual(["a, b"]);
	});
});
