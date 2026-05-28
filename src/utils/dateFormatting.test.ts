import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	formatDateValue,
	formatISODate,
	parseDateInputValue,
} from "./dateFormatting";

describe("dateFormatting", () => {
	beforeEach(() => {
		(globalThis as { window?: unknown }).window ??= globalThis;
	});

	it("formats Jalali dates with moment-jalaali tokens", () => {
		expect(
			formatDateValue({
				date: new Date(2026, 4, 28, 12),
				format: "jYYYY-jMM-jDD",
				calendar: "jalali",
			}),
		).toBe("1405-03-07");
	});

	it("formats Nowruz boundary dates", () => {
		expect(
			formatDateValue({
				date: new Date(2024, 2, 20, 12),
				format: "jYYYY-jMM-jDD",
				calendar: "jalali",
			}),
		).toBe("1403-01-01");
	});

	it("keeps Gregorian formatting on window.moment", () => {
		const format = vi.fn(() => "2026-05-28");
		(globalThis as any).window.moment = vi.fn(() => ({
			add: vi.fn(function () { return this; }),
			format,
		}));

		expect(
			formatDateValue({
				date: new Date(2026, 4, 28, 12),
				format: "YYYY-MM-DD",
				calendar: "gregorian",
			}),
		).toBe("2026-05-28");
		expect(format).toHaveBeenCalledWith("YYYY-MM-DD");
	});

	it("formats ISO strings with Jalali calendar", () => {
		expect(
			formatISODate(
				"2026-05-28T12:00:00.000Z",
				"jYYYY-jMM-jDD",
				"jalali",
			),
		).toBe("1405-03-07");
	});

	it("parses exact Jalali input with strict moment-jalaali tokens", () => {
		expect(
			parseDateInputValue({
				value: "1405-03-07",
				format: "jYYYY-jMM-jDD",
				calendar: "jalali",
			}),
		).toMatchObject({
			formatted: "1405-03-07",
			isoString: "2026-05-28T00:00:00.000Z",
		});
	});

	it("rejects invalid Jalali dates when parsing exact input", () => {
		expect(
			parseDateInputValue({
				value: "1405-13-07",
				format: "jYYYY-jMM-jDD",
				calendar: "jalali",
			}),
		).toBeNull();
	});
});
