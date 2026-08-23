import realMoment from "moment";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	DATE_REGEX,
	DATE_REGEX_FORMATTED,
	TIME_REGEX_FORMATTED,
} from "../constants";
import { getDate } from "./dates";

// getDate reads the wall clock via window.moment(); install the real moment and
// freeze "now" so the snap behaviour is deterministic. en locale = Sunday-first.
const originalMoment = (window as unknown as { moment?: unknown }).moment;
const previousLocale = realMoment.locale();

beforeAll(() => {
	realMoment.locale("en");
	(window as unknown as { moment: unknown }).moment = realMoment;
});
afterAll(() => {
	(window as unknown as { moment?: unknown }).moment = originalMoment;
	realMoment.locale(previousLocale);
});
afterEach(() => {
	vi.useRealTimers();
});

function freeze(isoLocal: string) {
	vi.useFakeTimers();
	vi.setSystemTime(new Date(isoLocal));
}

describe("getDate snap — issue #511 canonical guard", () => {
	it("week-snaps the month so a weekly note filename matches the week's month", () => {
		freeze("2023-06-01T12:00:00"); // Thursday, week belongs to May
		// The fix:
		expect(
			getDate({
				format: "gggg.MM.[Wk]w",
				snap: { boundary: "start", unit: "week" },
			}),
		).toBe("2023.05.Wk22");
		// The bug it diverges from (naive {{DATE}} stays today's month):
		expect(getDate({ format: "gggg.MM.[Wk]w" })).toBe("2023.06.Wk22");
		// The heading is day-actual and untouched:
		expect(getDate({ format: "M.DD dddd" })).toBe("6.01 Thursday");
	});

	it("keeps the week's month/week-year correct across year boundaries", () => {
		freeze("2023-12-31T12:00:00"); // Sunday — its week rolls into week-year 2024
		expect(
			getDate({
				format: "gggg.MM.[Wk]w",
				snap: { boundary: "start", unit: "week" },
			}),
		).toBe("2024.12.Wk1");

		freeze("2022-01-01T12:00:00"); // Saturday — week starts Dec 26 2021
		expect(
			getDate({
				format: "gggg.MM.[Wk]w",
				snap: { boundary: "start", unit: "week" },
			}),
		).toBe("2022.12.Wk1");
	});
});

describe("getDate snap — other units & composition", () => {
	beforeEach(() => freeze("2023-06-16T13:45:00"));

	it("startof:month / endof:month", () => {
		expect(
			getDate({ format: "YYYY-MM-DD", snap: { boundary: "start", unit: "month" } }),
		).toBe("2023-06-01");
		expect(
			getDate({ format: "YYYY-MM-DD", snap: { boundary: "end", unit: "month" } }),
		).toBe("2023-06-30");
	});

	it("ISO week anchors to Monday", () => {
		expect(
			getDate({
				format: "GGGG-[W]WW",
				snap: { boundary: "start", unit: "isoWeek" },
			}),
		).toBe("2023-W24");
	});

	it("applies the +N days offset BEFORE the snap", () => {
		// 2023-06-16 (Fri) + 7 = 2023-06-23 (Fri); startOf week = Sun 2023-06-18.
		expect(
			getDate({
				format: "YYYY-MM-DD",
				offset: 7,
				snap: { boundary: "start", unit: "week" },
			}),
		).toBe("2023-06-18");
	});

	it("leaves the default format / offset behaviour unchanged when no snap", () => {
		expect(getDate({ format: "YYYY-MM-DD" })).toBe("2023-06-16");
		expect(getDate()).toBe("2023-06-16");
		expect(getDate({ offset: -1, format: "YYYY-MM-DD" })).toBe("2023-06-15");
	});
});

describe("DATE regex grammar (backward-compat + snap option)", () => {
	it("parses a formatted snap option into format + options groups", () => {
		const m = "{{DATE:gggg.MM.[Wk]w|startof:week}}".match(DATE_REGEX_FORMATTED);
		expect(m?.[1]).toBe("gggg.MM.[Wk]w");
		expect(m?.[2]).toBeUndefined(); // no offset
		expect(m?.[3]).toBe("startof:week");
	});

	it("parses offset + snap together (offset stays before the snap)", () => {
		const m = "{{DATE:YYYY-MM-DD+7|startof:week}}".match(DATE_REGEX_FORMATTED);
		expect(m?.[1]).toBe("YYYY-MM-DD");
		expect(m?.[2]).toBe("+7");
		expect(m?.[3]).toBe("startof:week");
	});

	it("parses case after the format, offset, and optional snap", () => {
		const simple = "{{DATE:dddd, MMMM Do, yyyy.|case:lower}}".match(
			DATE_REGEX_FORMATTED,
		);
		expect(simple?.[1]).toBe("dddd, MMMM Do, yyyy.");
		expect(simple?.[4]).toBe("lower");

		const composed =
			"{{DATE:MMMM YYYY+7|startof:month|case:upper}}".match(
				DATE_REGEX_FORMATTED,
			);
		expect(composed?.[1]).toBe("MMMM YYYY");
		expect(composed?.[2]).toBe("+7");
		expect(composed?.[3]).toBe("startof:month");
		expect(composed?.[4]).toBe("upper");
	});

	it("keeps a literal pipe in the format byte-identical (no snap keyword)", () => {
		const m = "{{DATE:YYYY|MM}}".match(DATE_REGEX_FORMATTED);
		expect(m?.[1]).toBe("YYYY|MM"); // whole thing stays the format
		expect(m?.[3]).toBeUndefined(); // no snap option captured
	});

	it("keeps a bracketed case-like literal inside the moment format", () => {
		const m = "{{DATE:YYYY[|case:lower]}}".match(DATE_REGEX_FORMATTED);
		expect(m?.[1]).toBe("YYYY[|case:lower]");
		expect(m?.[4]).toBeUndefined();
	});

	it("keeps non-trailing case-like text inside date and time formats", () => {
		const date = "{{DATE:YYYY|case:lower|MM}}".match(DATE_REGEX_FORMATTED);
		const time = "{{TIME:HH|case:lower|mm}}".match(TIME_REGEX_FORMATTED);
		expect(date?.[1]).toBe("YYYY|case:lower|MM");
		expect(date?.[4]).toBeUndefined();
		expect(time?.[1]).toBe("HH|case:lower|mm");
		expect(time?.[2]).toBeUndefined();
	});

	it("keeps an incomplete bracket literal usable while typing", () => {
		const date = "{{DATE:YYYY[Week}}".match(DATE_REGEX_FORMATTED);
		const time = "{{TIME:HH[hours}}".match(TIME_REGEX_FORMATTED);
		expect(date?.[1]).toBe("YYYY[Week");
		expect(time?.[1]).toBe("HH[hours");
	});

	it("treats a |startof: inside a [literal] (non-letter after colon) as format, not snap", () => {
		// Only a trailing |startof:<letters> is the snap; an earlier |startof:
		// with a space/non-letter after the colon stays in the format and must
		// NOT abort the run with an 'unknown unit' error.
		const m = "{{DATE:[literal |startof: label ]YYYY-MM-DD|startof:month}}".match(
			DATE_REGEX_FORMATTED,
		);
		expect(m?.[1]).toBe("[literal |startof: label ]YYYY-MM-DD");
		expect(m?.[3]).toBe("startof:month");
	});

	it("leaves a malformed double-snap token literal (no match, no throw)", () => {
		expect(
			"{{DATE:YYYY|startof:week|endof:month}}".match(DATE_REGEX_FORMATTED),
		).toBeNull();
	});

	it("does NOT support offset-before-colon (stays literal)", () => {
		expect("{{DATE+7:YYYY-MM-DD|startof:week}}".match(DATE_REGEX_FORMATTED)).toBeNull();
	});

	it("keeps a literal '+' format unmatched, exactly like master", () => {
		expect("{{DATE:YYYY+MM}}".match(DATE_REGEX_FORMATTED)).toBeNull();
	});

	it("parses bare {{DATE}} with and without a snap option", () => {
		expect("{{DATE}}".match(DATE_REGEX)?.[2]).toBeUndefined();
		expect("{{DATE|startof:month}}".match(DATE_REGEX)?.[2]).toBe("startof:month");
		expect("{{DATE+1|endof:week}}".match(DATE_REGEX)?.[1]).toBe("+1");
		expect("{{DATE+1|endof:week}}".match(DATE_REGEX)?.[2]).toBe("endof:week");
		expect("{{DATE|case:upper}}".match(DATE_REGEX)?.[3]).toBe("upper");
	});

	it("matches snap tokens in LINEAR time on long malformed input (no ReDoS)", () => {
		// `|startof:`×N with no closing `}}` is the catastrophic-backtracking shape
		// that a lazy/overlapping format slot would blow up on (O(n^2)). The
		// mutually-exclusive format arm keeps this linear.
		const evil = `{{DATE:${"|startof:".repeat(30000)}`;
		const start = performance.now();
		expect(DATE_REGEX_FORMATTED.test(evil)).toBe(false);
		expect(performance.now() - start).toBeLessThan(100);
	});

	it("rejects repeated bracket literals in linear time when the token is malformed", () => {
		const date = `{{DATE:${"[]".repeat(30000)}+X}}`;
		const time = `{{TIME:${"[]".repeat(30000)}+X}}`;
		const start = performance.now();
		expect(DATE_REGEX_FORMATTED.test(date)).toBe(false);
		expect(TIME_REGEX_FORMATTED.test(time)).toBe(false);
		expect(performance.now() - start).toBeLessThan(100);
	});
});
