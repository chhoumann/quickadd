import { describe, expect, it } from "vitest";
import {
	mapMappedSuggesterValue,
	resolveDropdownInitialValue,
} from "./suggesterValueMapping";

describe("mapMappedSuggesterValue", () => {
	it("maps selected display values when input comes from completion", () => {
		const displayToValue = new Map<string, string>([
			["Normal", "🔼"],
			["High", "⏫"],
		]);
		expect(
			mapMappedSuggesterValue("High", displayToValue, true),
		).toBe("⏫");
	});

	it("keeps typed custom values unchanged", () => {
		const displayToValue = new Map<string, string>([
			["Normal", "🔼"],
			["High", "⏫"],
		]);
		expect(
			mapMappedSuggesterValue("High", displayToValue, false),
		).toBe("High");
		expect(
			mapMappedSuggesterValue("Urgent!", displayToValue, false),
		).toBe("Urgent!");
	});

	it("falls back to the raw value when no mapping exists", () => {
		const displayToValue = new Map<string, string>([["Normal", "🔼"]]);
		expect(
			mapMappedSuggesterValue("Custom", displayToValue, true),
		).toBe("Custom");
	});
});

describe("resolveDropdownInitialValue", () => {
	it("uses the first raw option when starting empty", () => {
		expect(
			resolveDropdownInitialValue("", ["#BF616A", "#8CC570"]),
		).toBe("#BF616A");
	});

	it("preserves non-empty starting values that still exist in options", () => {
		expect(
			resolveDropdownInitialValue("#8CC570", ["#BF616A", "#8CC570"]),
		).toBe("#8CC570");
	});

	it("normalizes stale non-empty starting values to the first raw option", () => {
		expect(
			resolveDropdownInitialValue("stale", ["#BF616A", "#8CC570"]),
		).toBe("#BF616A");
	});

	it("preserves starting values when there are no options", () => {
		expect(resolveDropdownInitialValue("", [])).toBe("");
		expect(resolveDropdownInitialValue("existing", [])).toBe("existing");
	});
});
