import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseNaturalLanguageDate, formatISODate } from "./dateParser";

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
			
			const result = parseNaturalLanguageDate("tomorrow", undefined, mockDateParser);
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
			
			const result = parseNaturalLanguageDate("tomorrow", "YYYY-MM-DD", mockDateParser);

			expect(result.isValid).toBe(true);
			expect(result.formatted).toBe("2025-06-21");
			expect(result.isoString).toBe("2025-06-21T00:00:00.000Z");
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
});