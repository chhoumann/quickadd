import { describe, expect, it, vi } from "vitest";
import { parseDateFormatToken, parseDateVariableToken } from "./dateFormatSyntax";

const logWarningMock = vi.hoisted(() => vi.fn());

vi.mock("../logger/logManager", () => ({
	log: {
		logWarning: logWarningMock,
	},
}));

describe("dateFormatSyntax", () => {
	describe("parseDateFormatToken", () => {
		it("defaults to Gregorian formatting", () => {
			expect(parseDateFormatToken("YYYY-MM-DD")).toEqual({
				format: "YYYY-MM-DD",
				calendar: "gregorian",
				locale: "default",
				offset: undefined,
			});
		});

		it("parses Jalali calendar options", () => {
			expect(
				parseDateFormatToken("jYYYY-jMM-jDD|calendar:jalali"),
			).toEqual({
				format: "jYYYY-jMM-jDD",
				calendar: "jalali",
				locale: "default",
				offset: undefined,
			});
		});

		it("accepts Jalali aliases", () => {
			expect(
				parseDateFormatToken("jYYYY-jMM-jDD|calendar:jalaali").calendar,
			).toBe("jalali");
			expect(
				parseDateFormatToken("jYYYY-jMM-jDD|calendar:persian").calendar,
			).toBe("jalali");
		});

		it("parses positive and negative offsets before options", () => {
			expect(
				parseDateFormatToken("jYYYY-jMM-jDD+3|calendar:jalali"),
			).toMatchObject({
				format: "jYYYY-jMM-jDD",
				calendar: "jalali",
				offset: 3,
			});
			expect(
				parseDateFormatToken("jYYYY-jMM-jDD+-3|calendar:jalali"),
			).toMatchObject({
				format: "jYYYY-jMM-jDD",
				calendar: "jalali",
				offset: -3,
			});
		});

		it("keeps plus signs that are not trailing numeric offsets", () => {
			expect(parseDateFormatToken("YYYY-MM-DD+literal")).toEqual({
				format: "YYYY-MM-DD+literal",
				calendar: "gregorian",
				locale: "default",
				offset: undefined,
			});
		});

		it("preserves unrecognized pipe segments as format text", () => {
			expect(parseDateFormatToken("YYYY|MM|calendar:gregorian")).toEqual({
				format: "YYYY|MM",
				calendar: "gregorian",
				locale: "default",
				offset: undefined,
			});
		});

		it("falls back to Gregorian for unsupported calendars", () => {
			expect(
				parseDateFormatToken("YYYY-MM-DD|calendar:martian").calendar,
			).toBe("gregorian");
			expect(logWarningMock).toHaveBeenCalledOnce();
		});

		it("parses the locale option and its aliases", () => {
			expect(
				parseDateFormatToken("jYYYY/jMM/jDD|calendar:jalali|locale:fa")
					.locale,
			).toBe("fa");
			expect(
				parseDateFormatToken("jYYYY/jMM/jDD|locale:farsi").locale,
			).toBe("fa");
			expect(
				parseDateFormatToken("jYYYY/jMM/jDD|locale:persian").locale,
			).toBe("fa");
		});

		it("defaults the locale and warns on unsupported values", () => {
			expect(parseDateFormatToken("YYYY-MM-DD").locale).toBe("default");
			expect(
				parseDateFormatToken("YYYY-MM-DD|locale:klingon").locale,
			).toBe("default");
			expect(logWarningMock).toHaveBeenCalled();
		});
	});

	describe("parseDateVariableToken", () => {
		it("preserves legacy shorthand defaults", () => {
			expect(
				parseDateVariableToken({
					variableName: "due",
					dateFormat: "YYYY-MM-DD",
					rawOptions: "today",
				}),
			).toEqual({
				variableName: "due",
				format: "YYYY-MM-DD",
				calendar: "gregorian",
				locale: "default",
				defaultValue: "today",
			});
		});

		it("parses calendar and keyed default options", () => {
			expect(
				parseDateVariableToken({
					variableName: "due",
					dateFormat: "jYYYY-jMM-jDD",
					rawOptions: "calendar:jalali|default:today",
				}),
			).toEqual({
				variableName: "due",
				format: "jYYYY-jMM-jDD",
				calendar: "jalali",
				locale: "default",
				defaultValue: "today",
			});
		});

		it("treats recognized option keys as keyed option mode", () => {
			expect(
				parseDateVariableToken({
					variableName: "due",
					dateFormat: "YYYY-MM-DD",
					rawOptions: "calendar:jalali|today",
				}),
			).toEqual({
				variableName: "due",
				format: "YYYY-MM-DD",
				calendar: "jalali",
				locale: "default",
				defaultValue: undefined,
			});
		});

		it("allows calendar options without defaults", () => {
			expect(
				parseDateVariableToken({
					variableName: "due",
					dateFormat: "jYYYY-jMM-jDD",
					rawOptions: "calendar:jalali",
				}),
			).toEqual({
				variableName: "due",
				format: "jYYYY-jMM-jDD",
				calendar: "jalali",
				locale: "default",
				defaultValue: undefined,
			});
		});

		it("parses calendar, locale, and keyed default together", () => {
			expect(
				parseDateVariableToken({
					variableName: "due",
					dateFormat: "jYYYY/jMM/jDD",
					rawOptions: "calendar:jalali|locale:fa|default:today",
				}),
			).toEqual({
				variableName: "due",
				format: "jYYYY/jMM/jDD",
				calendar: "jalali",
				locale: "fa",
				defaultValue: "today",
			});
		});
	});
});
