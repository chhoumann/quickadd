import { describe, expect, it } from "vitest";
import { extractTimeFromIso, toIsoFromParts } from "./datePicker";

describe("toIsoFromParts", () => {
	it("emits a bare date key with no time (byte-identical to date-only)", () => {
		expect(toIsoFromParts(2025, 11, 25)).toBe("2025-12-25");
		expect(toIsoFromParts(2025, 11, 25, null)).toBe("2025-12-25");
	});

	it("emits an offset-less local datetime when given a time", () => {
		expect(toIsoFromParts(2025, 11, 25, { hour: 14, minute: 30 })).toBe(
			"2025-12-25T14:30:00",
		);
		expect(toIsoFromParts(2026, 0, 5, { hour: 9, minute: 5 })).toBe(
			"2026-01-05T09:05:00",
		);
	});
});

describe("extractTimeFromIso", () => {
	it("reads HH:mm from a T-separated datetime", () => {
		expect(extractTimeFromIso("2025-12-25T14:30:00")).toEqual({
			hour: 14,
			minute: 30,
		});
	});

	it("reads HH:mm from a space-separated datetime", () => {
		expect(extractTimeFromIso("2025-12-25 09:05")).toEqual({
			hour: 9,
			minute: 5,
		});
	});

	it("returns null for a date-only string or undefined", () => {
		expect(extractTimeFromIso("2025-12-25")).toBeNull();
		expect(extractTimeFromIso(undefined)).toBeNull();
	});

	it("rejects out-of-range hours/minutes", () => {
		expect(extractTimeFromIso("2025-12-25T99:99")).toBeNull();
		expect(extractTimeFromIso("2025-12-25T24:00")).toBeNull();
		expect(extractTimeFromIso("2025-12-25T12:60")).toBeNull();
		expect(extractTimeFromIso("2025-12-25T23:59")).toEqual({
			hour: 23,
			minute: 59,
		});
	});
});
