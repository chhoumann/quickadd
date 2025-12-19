import { describe, it, expect } from "vitest";
import {
	formatDateAliasLines,
	getDateAliasSummary,
	normalizeDateInput,
	parseDateAliasLines,
} from "./dateAliases";

describe("dateAliases", () => {
	it("normalizes direct aliases", () => {
		const result = normalizeDateInput("tm", { tm: "tomorrow" });
		expect(result).toBe("tomorrow");
	});

	it("normalizes aliases in the first token", () => {
		const result = normalizeDateInput("tm 5pm", { tm: "tomorrow" });
		expect(result).toBe("tomorrow 5pm");
	});

	it("leaves non-alias input untouched", () => {
		const result = normalizeDateInput("next friday", { tm: "tomorrow" });
		expect(result).toBe("next friday");
	});

	it("parses alias lines into a map", () => {
		const parsed = parseDateAliasLines("tm = tomorrow\n# comment\nyd=yesterday");
		expect(parsed).toEqual({ tm: "tomorrow", yd: "yesterday" });
	});

	it("formats aliases back into lines", () => {
		const formatted = formatDateAliasLines({
			tm: "tomorrow",
			yd: "yesterday",
		});
		expect(formatted).toBe("tm = tomorrow\nyd = yesterday");
	});

	it("builds a short alias summary", () => {
		const summary = getDateAliasSummary({
			tm: "tomorrow",
			yd: "yesterday",
		});
		expect(summary).toContain("tm=tomorrow");
	});
});
