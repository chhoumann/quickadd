import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseNaturalLanguageDate, formatISODate } from "./dateParser";
import type { App } from "obsidian";

describe("dateParser", () => {
	describe("parseNaturalLanguageDate", () => {
		it("should return error when input is empty", () => {
			const mockApp = {} as App;
			const result = parseNaturalLanguageDate(mockApp, "");
			expect(result.isValid).toBe(false);
			expect(result.error).toBe("Empty input");
		});

		it("should return error when input is only whitespace", () => {
			const mockApp = {} as App;
			const result = parseNaturalLanguageDate(mockApp, "   ");
			expect(result.isValid).toBe(false);
			expect(result.error).toBe("Empty input");
		});

		it("should use built-in chrono parser", () => {
			const mockApp = {
				plugins: {
					plugins: {}
				}
			} as unknown as App;
			
			const result = parseNaturalLanguageDate(mockApp, "tomorrow");
			// Built-in chrono parser should work
			expect(result.isValid).toBe(true);
			expect(result.isoString).toBeDefined();
		});

		it("should parse valid date with custom format", () => {
			const mockApp = {
				plugins: {
					plugins: {}
				}
			} as unknown as App;

			const result = parseNaturalLanguageDate(mockApp, "tomorrow", "YYYY-MM-DD");
			
			expect(result.isValid).toBe(true);
			expect(result.formatted).toBe("2025-06-21"); // Based on test stub moment
			expect(result.isoString).toBe("2025-06-21T00:00:00.000Z");
		});

		it("should return error when date parsing fails", () => {
			const mockApp = {
				plugins: {
					plugins: {
						"nldates-obsidian": {
							parseDate: (input: string) => ({
								moment: {
									isValid: () => false
								}
							})
						}
					}
				}
			} as unknown as App;

			const result = parseNaturalLanguageDate(mockApp, "invalid date");
			
			expect(result.isValid).toBe(false);
			expect(result.error).toBe("Unable to parse date");
		});

		it("should handle unparseable input gracefully", () => {
			const mockApp = {
				plugins: {
					plugins: {}
				}
			} as unknown as App;

			// Test with input that chrono can't parse
			const result = parseNaturalLanguageDate(mockApp, "not a valid date at all");
			
			expect(result.isValid).toBe(false);
			expect(result.error).toBe("Unable to parse date");
		});
	});

	describe("formatISODate", () => {
		beforeEach(() => {
			// Mock window.moment
			(window as Window & { moment?: unknown }).moment = vi.fn((iso: string) => ({
				isValid: () => iso.includes("2025"),
				format: (fmt: string) => `formatted-${fmt}`
			}));
		});

		afterEach(() => {
			delete (window as Window & { moment?: unknown }).moment;
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
			delete (window as Window & { moment?: unknown }).moment;
			const result = formatISODate("2025-07-11T00:00:00.000Z", "YYYY-MM-DD");
			expect(result).toBe(null);
		});
	});
});