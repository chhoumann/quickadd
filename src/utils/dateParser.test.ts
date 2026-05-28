import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	coerceToDateVariable,
	formatISODate,
	parseNaturalLanguageDate,
} from "./dateParser";

describe("dateParser", () => {
	describe("parseNaturalLanguageDate", () => {
		it("should return error when input is empty", () => {
			const result = parseNaturalLanguageDate("");
			expect(result.isValid).toBe(false);
			expect(result.error).toBe("Empty input");
		});

		it("should return error when input is only whitespace", () => {
			const result = parseNaturalLanguageDate("   ");
			expect(result.isValid).toBe(false);
			expect(result.error).toBe("Empty input");
		});

		it("should use built-in chrono parser", () => {
			// Mock date parser that returns a valid parsed moment
			const mockDateParser = {
				parseDate: vi.fn().mockReturnValue({
					moment: {
						isValid: () => true,
						toISOString: () => "2025-06-21T00:00:00.000Z",
						format: (fmt: string) => fmt === "YYYY-MM-DD" ? "2025-06-21" : "2025-06-21T00:00:00.000Z"
					}
				})
			};
			
			const result = parseNaturalLanguageDate("tomorrow", {
				dateParser: mockDateParser,
			});
			// Built-in chrono parser should work
			expect(result.isValid).toBe(true);
			expect(result.isoString).toBeDefined();
		});

		it("should parse valid date with custom format", () => {
			// Mock date parser that returns a valid parsed moment
			const mockDateParser = {
				parseDate: vi.fn().mockReturnValue({
					moment: {
						isValid: () => true,
						toISOString: () => "2025-06-21T00:00:00.000Z",
						format: (fmt: string) => fmt === "YYYY-MM-DD" ? "2025-06-21" : "formatted-date"
					}
				})
			};
			
			const result = parseNaturalLanguageDate("tomorrow", {
				format: "YYYY-MM-DD",
				dateParser: mockDateParser,
			});

			expect(result.isValid).toBe(true);
			expect(result.formatted).toBe("2025-06-21");
			expect(result.isoString).toBe("2025-06-21T00:00:00.000Z");
		});

		it("should normalize aliases before parsing", () => {
			const mockDateParser = {
				parseDate: vi.fn().mockReturnValue({
					moment: {
						isValid: () => true,
						toISOString: () => "2025-06-21T00:00:00.000Z",
						format: () => "2025-06-21",
					},
				}),
			};

			parseNaturalLanguageDate("tm 5pm", {
				dateParser: mockDateParser,
				aliases: { tm: "tomorrow" },
			});

			expect(mockDateParser.parseDate).toHaveBeenCalledWith("tomorrow 5pm");
		});

		it("should parse exact Jalali input before natural language fallback", () => {
			const mockDateParser = {
				parseDate: vi.fn(),
			};

			const result = parseNaturalLanguageDate("1405-03-07", {
				format: "jYYYY-jMM-jDD",
				dateParser: mockDateParser,
				calendar: "jalali",
			});

			expect(result.isValid).toBe(true);
			expect(result.formatted).toBe("1405-03-07");
			expect(result.isoString).toContain("2026-05-27T22:00:00.000Z");
			expect(mockDateParser.parseDate).not.toHaveBeenCalled();
		});

		it("should fall back to natural language parsing for invalid Jalali input", () => {
			const mockDateParser = {
				parseDate: vi.fn().mockReturnValue(null),
			};

			const result = parseNaturalLanguageDate("1405-13-07", {
				format: "jYYYY-jMM-jDD",
				dateParser: mockDateParser,
				calendar: "jalali",
			});

			expect(result.isValid).toBe(false);
			expect(mockDateParser.parseDate).toHaveBeenCalledWith("1405-13-07");
		});

		it("should return error when date parsing fails", () => {
			const result = parseNaturalLanguageDate("invalid date");

			expect(result.isValid).toBe(false);
			expect(result.error).toBe("Unable to parse date");
		});

		it("should handle unparseable input gracefully", () => {
			const result = parseNaturalLanguageDate("not a valid date at all");

			expect(result.isValid).toBe(false);
			expect(result.error).toBe("Unable to parse date");
		});
	});

	describe("formatISODate", () => {
		beforeEach(() => {
			// Mock window.moment
			(window as Window & { moment?: unknown; }).moment = vi.fn((iso: string) => ({
				isValid: () => iso.includes("2025"),
				format: (fmt: string) => `formatted-${fmt}`
			}));
		});

		afterEach(() => {
			delete (window as Window & { moment?: unknown; }).moment;
		});

		it("should format valid ISO date", () => {
			const result = formatISODate("2025-07-11T00:00:00.000Z", "YYYY-MM-DD");
			expect(result).toBe("formatted-YYYY-MM-DD");
		});

		it("should return null for invalid ISO date", () => {
			const result = formatISODate("invalid-date", "YYYY-MM-DD");
			expect(result).toBe(null);
		});

		it("should return null when moment is not available", () => {
			delete (window as Window & { moment?: unknown; }).moment;
			const result = formatISODate("2025-07-11T00:00:00.000Z", "YYYY-MM-DD");
			expect(result).toBe(null);
		});
	});

	describe("coerceToDateVariable", () => {
		it("returns existing internal date variables unchanged", () => {
			expect(coerceToDateVariable("@date:2025-07-11T00:00:00.000Z"))
				.toBe("@date:2025-07-11T00:00:00.000Z");
		});

		it("coerces exact Jalali input through the canonical parser", () => {
			const result = coerceToDateVariable("1405-03-07", {
				format: "jYYYY-jMM-jDD",
				calendar: "jalali",
			});

			expect(result).toBe("@date:2026-05-27T22:00:00.000Z");
		});

		it("coerces Date objects", () => {
			const date = new Date("2025-07-11T00:00:00.000Z");

			expect(coerceToDateVariable(date))
				.toBe("@date:2025-07-11T00:00:00.000Z");
		});
	});
});
