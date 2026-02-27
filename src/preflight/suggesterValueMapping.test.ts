import { describe, expect, it } from "vitest";
import { mapMappedSuggesterValue } from "./suggesterValueMapping";

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
