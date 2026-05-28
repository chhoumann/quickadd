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

	it("renders Persian digits with the fa locale", () => {
		expect(
			formatDateValue({
				date: new Date(2026, 4, 28, 12),
				format: "jYYYY/jMM/jDD",
				calendar: "jalali",
				locale: "fa",
			}),
		).toBe("۱۴۰۵/۰۳/۰۷");
	});

	it("renders Persian month names with the fa locale", () => {
		expect(
			formatDateValue({
				date: new Date(2026, 4, 28, 12),
				format: "jD jMMMM jYYYY",
				calendar: "jalali",
				locale: "fa",
			}),
		).toBe("۷ خرداد ۱۴۰۵");
	});

	it("keeps the default jalali locale Latin after fa is used", () => {
		// fa load is global to moment-jalaali; the default path must stay Latin.
		formatDateValue({
			date: new Date(2026, 4, 28, 12),
			format: "jYYYY/jMM/jDD",
			calendar: "jalali",
			locale: "fa",
		});

		expect(
			formatDateValue({
				date: new Date(2026, 4, 28, 12),
				format: "jD jMMMM jYYYY",
				calendar: "jalali",
			}),
		).toBe("7 Khordaad 1405");
	});

	it("applies offsets to jalali dates", () => {
		expect(
			formatDateValue({
				date: new Date(2026, 4, 28, 12),
				format: "jYYYY-jMM-jDD",
				calendar: "jalali",
				offset: 3,
			}),
		).toBe("1405-03-10");
	});

	it("formats ISO strings in Persian with the fa locale", () => {
		expect(
			formatISODate(
				"2026-05-28T12:00:00.000Z",
				"jYYYY/jMM/jDD",
				"jalali",
				"fa",
			),
		).toBe("۱۴۰۵/۰۳/۰۷");
	});

	it("parses Persian-digit input and renders it back in Persian", () => {
		expect(
			parseDateInputValue({
				value: "۱۴۰۵-۰۳-۰۷",
				format: "jYYYY-jMM-jDD",
				calendar: "jalali",
				locale: "fa",
			}),
		).toMatchObject({
			formatted: "۱۴۰۵-۰۳-۰۷",
			isoString: "2026-05-28T00:00:00.000Z",
		});
	});

	it("accepts Latin input even when the fa locale is requested", () => {
		expect(
			parseDateInputValue({
				value: "1405-03-07",
				format: "jYYYY-jMM-jDD",
				calendar: "jalali",
				locale: "fa",
			}),
		).toMatchObject({
			formatted: "۱۴۰۵-۰۳-۰۷",
			isoString: "2026-05-28T00:00:00.000Z",
		});
	});
});
