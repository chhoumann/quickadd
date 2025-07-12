import { describe, it, expect, vi } from "vitest";
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

		it("should return error when NLD plugin is not available", () => {
			const mockApp = {
				plugins: {
					plugins: {}
				}
			} as unknown as App;
			
			const result = parseNaturalLanguageDate(mockApp, "tomorrow");
			expect(result.isValid).toBe(false);
			expect(result.error).toBe("Natural Language Dates plugin is not installed or enabled");
		});

		it("should parse valid date when NLD plugin is available", () => {
			const mockApp = {
				plugins: {
					plugins: {
						"nldates-obsidian": {
							parseDate: (input: string) => ({
								moment: {
									format: (fmt: string) => "2025-07-11",
									toISOString: () => "2025-07-11T00:00:00.000Z",
									isValid: () => true
								}
							})
						}
					}
				}
			} as unknown as App;

			const result = parseNaturalLanguageDate(mockApp, "tomorrow", "YYYY-MM-DD");
			
			expect(result.isValid).toBe(true);
			expect(result.formatted).toBe("2025-07-11");
			expect(result.isoString).toBe("2025-07-11T00:00:00.000Z");
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

		it("should handle parse exceptions gracefully", () => {
			const mockApp = {
				plugins: {
					plugins: {
						"nldates-obsidian": {
							parseDate: () => {
								throw new Error("Parse error");
							}
						}
					}
				}
			} as unknown as App;

			const result = parseNaturalLanguageDate(mockApp, "error date");
			
			expect(result.isValid).toBe(false);
			expect(result.error).toBe("Parse error: Parse error");
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