import { describe, expect, it } from "vitest";
import { NLDParser, prefersForwardDate } from "./NLDParser";

// Tuesday 2026-09-01, noon local time.
const TUESDAY = new Date(2026, 8, 1, 12);

function localDay(date: Date | null): string | null {
	if (!date) return null;
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

describe("NLDParser", () => {
	it.each([
		{
			input: "March 13, 2022 at 2:30 AM UTC",
			expected: "2022-03-13T02:30:00.000Z",
		},
		{
			input: "March 27, 2022 at 2:30 AM UTC",
			expected: "2022-03-27T02:30:00.000Z",
		},
	])("parses $input independently of the host DST gap", ({ input, expected }) => {
		expect(NLDParser.getParsedDate(input)?.toISOString()).toBe(expected);
	});

	describe("explicit past phrases resolve backwards", () => {
		it.each([
			{ input: "last thursday", expected: "2026-08-27" },
			{ input: "last friday", expected: "2026-08-28" },
			{ input: "Last Friday", expected: "2026-08-28" },
			// Today is Tuesday, so last Monday is yesterday, not next week.
			{ input: "last monday", expected: "2026-08-31" },
			// Same weekday as today: a full week back, not today or next week.
			{ input: "last tuesday", expected: "2026-08-25" },
			{ input: "past friday", expected: "2026-08-28" },
			{ input: "previous friday", expected: "2026-08-28" },
			{ input: "previous monday", expected: "2026-08-31" },
			{ input: "friday last week", expected: "2026-08-28" },
			{ input: "friday of last week", expected: "2026-08-28" },
			{ input: "last weekend", expected: "2026-08-30" },
		])("$input -> $expected", ({ input, expected }) => {
			expect(localDay(NLDParser.getParsedDate(input, TUESDAY))).toBe(expected);
		});

		it("keeps the time of day on an explicit past phrase", () => {
			const parsed = NLDParser.getParsedDate("last friday at 3pm", TUESDAY);
			expect(localDay(parsed)).toBe("2026-08-28");
			expect(parsed?.getHours()).toBe(15);
		});
	});

	describe("ambiguous phrases still prefer the future", () => {
		it.each([
			{ input: "friday", expected: "2026-09-04" },
			{ input: "thursday", expected: "2026-09-03" },
			// Bare weekday matching today resolves to today, not last week.
			{ input: "tuesday", expected: "2026-09-01" },
			// Monday already passed this week, so bare "monday" is next Monday.
			{ input: "monday", expected: "2026-09-07" },
			{ input: "next friday", expected: "2026-09-11" },
			{ input: "this friday", expected: "2026-09-04" },
			// Month-day without a year that already passed rolls into next year.
			{ input: "march 5", expected: "2027-03-05" },
			// Bare durations are only accepted with the forward preference.
			{ input: "3 days", expected: "2026-09-04" },
			// "past" as a clock word does not pin the day to the past.
			{ input: "friday at half past 3", expected: "2026-09-04" },
			{ input: "monday at quarter past 9", expected: "2026-09-07" },
			{ input: "march 5 at half past 3", expected: "2027-03-05" },
		])("$input -> $expected", ({ input, expected }) => {
			expect(localDay(NLDParser.getParsedDate(input, TUESDAY))).toBe(expected);
		});
	});

	describe("relative phrases are unchanged", () => {
		it.each([
			{ input: "today", expected: "2026-09-01" },
			{ input: "yesterday", expected: "2026-08-31" },
			{ input: "tomorrow", expected: "2026-09-02" },
			{ input: "3 days ago", expected: "2026-08-29" },
			{ input: "last week", expected: "2026-08-25" },
			{ input: "last month", expected: "2026-08-01" },
			{ input: "next week", expected: "2026-09-08" },
		])("$input -> $expected", ({ input, expected }) => {
			expect(localDay(NLDParser.getParsedDate(input, TUESDAY))).toBe(expected);
		});
	});

	describe("prefersForwardDate", () => {
		it.each([
			"friday",
			"next friday",
			"march 5",
			"tomorrow",
			"lastly friday",
			"3 days",
			"friday at half past 3",
			"quarter past 9 on monday",
			"past 3pm",
		])("keeps the forward preference for %j", (input) => {
			expect(prefersForwardDate(input)).toBe(true);
		});

		it.each([
			"last friday",
			"Past Monday",
			"previous thursday",
			"friday last week",
			"the past week",
			"past few days",
		])(
			"drops the forward preference for %j",
			(input) => {
				expect(prefersForwardDate(input)).toBe(false);
			},
		);
	});
});
