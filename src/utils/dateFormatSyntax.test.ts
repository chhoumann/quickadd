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
				offset: undefined,
			});
		});

		it("parses Jalali calendar options", () => {
			expect(
				parseDateFormatToken("jYYYY-jMM-jDD|calendar:jalali"),
			).toEqual({
				format: "jYYYY-jMM-jDD",
				calendar: "jalali",
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
				offset: undefined,
			});
		});

		it("preserves unrecognized pipe segments as format text", () => {
			expect(parseDateFormatToken("YYYY|MM|calendar:gregorian")).toEqual({
				format: "YYYY|MM",
				calendar: "gregorian",
				offset: undefined,
			});
		});

		it("falls back to Gregorian for unsupported calendars", () => {
			expect(
				parseDateFormatToken("YYYY-MM-DD|calendar:martian").calendar,
			).toBe("gregorian");
			expect(logWarningMock).toHaveBeenCalledOnce();
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
				defaultValue: undefined,
			});
		});
	});
});
