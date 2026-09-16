import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseNaturalLanguageDate, formatISODate } from "./dateParser";

describe("dateParser", () => {
	describe("parseNaturalLanguageDate", () => {
		it.each([
			["should return error when input is empty", "", "Empty input"],
			["should return error when input is only whitespace", "   ", "Empty input"],
			["should return error when date parsing fails", "invalid date", "Unable to parse date"],
			["should handle unparseable input gracefully", "not a valid date at all", "Unable to parse date"],
		] as const)("%s", (_name, input, expected) => {
			const result = parseNaturalLanguageDate(input);
			expect(result.isValid).toBe(false);
			expect(result.error).toBe(expected);
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

			parseNaturalLanguageDate("tm 5pm", undefined, mockDateParser, {
				tm: "tomorrow",
			});

			expect(mockDateParser.parseDate).toHaveBeenCalledWith("tomorrow 5pm");
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
