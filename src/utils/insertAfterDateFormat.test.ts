import { describe, expect, it } from "vitest";
import { detectDateFormatFromAfter } from "./insertAfterDateFormat";

// Guards the issue #511 regression: the ordered-log sort-format detector must
// strip a |startof:/|endof: snap option but PRESERVE literal pipes, so headings
// for different months still sort correctly.
describe("detectDateFormatFromAfter", () => {
	it("strips a snap option, keeping the sort format", () => {
		expect(detectDateFormatFromAfter("## {{DATE:gggg.MM.[Wk]w|startof:week}}")).toBe(
			"gggg.MM.[Wk]w",
		);
		expect(detectDateFormatFromAfter("{{DATE:YYYY-MM-DD|endof:month}}")).toBe(
			"YYYY-MM-DD",
		);
	});

	it("strips a snap option that follows an offset", () => {
		expect(detectDateFormatFromAfter("{{DATE:YYYY-MM-DD+7|startof:week}}")).toBe(
			"YYYY-MM-DD",
		);
	});

	it("PRESERVES a literal pipe in the sort format (the bot-found regression)", () => {
		expect(detectDateFormatFromAfter("{{DATE:YYYY|MM}}")).toBe("YYYY|MM");
		expect(detectDateFormatFromAfter("{{DATE:YYYY|MM|startof:month}}")).toBe(
			"YYYY|MM",
		);
	});

	it("detects plain DATE and VDATE formats (legacy behaviour)", () => {
		expect(detectDateFormatFromAfter("## {{DATE:YYYY-MM-DD}} log")).toBe(
			"YYYY-MM-DD",
		);
		expect(detectDateFormatFromAfter("{{VDATE:d,gggg-[W]WW}}")).toBe("gggg-[W]WW");
		expect(detectDateFormatFromAfter("{{VDATE:d,gggg-[W]WW|startof:week}}")).toBe(
			"gggg-[W]WW",
		);
	});

	it("returns undefined for a bare {{DATE}} or no token", () => {
		expect(detectDateFormatFromAfter("{{DATE}}")).toBeUndefined();
		expect(detectDateFormatFromAfter("# Today")).toBeUndefined();
	});
});
