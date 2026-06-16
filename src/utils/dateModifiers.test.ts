import moment from "moment";
import { beforeAll, describe, expect, it } from "vitest";
import {
	applyDateSnap,
	normalizeDateUnit,
	parseDateSnapSegment,
} from "./dateModifiers";

// `week` is locale-dependent (first day of week); pin to en (Sunday-first) so
// the assertions are deterministic. `isoWeek` is always Monday-anchored.
beforeAll(() => {
	moment.locale("en");
});

describe("normalizeDateUnit", () => {
	it("maps documented units (case-insensitive) to moment units", () => {
		expect(normalizeDateUnit("week")).toBe("week");
		expect(normalizeDateUnit("WEEK")).toBe("week");
		expect(normalizeDateUnit("isoweek")).toBe("isoWeek");
		expect(normalizeDateUnit("IsoWeek")).toBe("isoWeek");
		expect(normalizeDateUnit("month")).toBe("month");
		expect(normalizeDateUnit("quarter")).toBe("quarter");
		expect(normalizeDateUnit("year")).toBe("year");
		expect(normalizeDateUnit("day")).toBe("day");
	});

	it("accepts plural/short aliases", () => {
		expect(normalizeDateUnit("weeks")).toBe("week");
		expect(normalizeDateUnit("w")).toBe("week");
		expect(normalizeDateUnit("months")).toBe("month");
		expect(normalizeDateUnit("d")).toBe("day");
	});

	it("throws a self-correcting error on an unknown unit", () => {
		expect(() => normalizeDateUnit("fortnight")).toThrowError(
			/Unknown date unit "fortnight"\. Valid units: year, quarter, month, week, isoweek, day\./,
		);
		// A no-op-prone typo must fail loudly, never silently pass through.
		expect(() => normalizeDateUnit("wek")).toThrow();
	});
});

describe("parseDateSnapSegment", () => {
	it("parses startof:/endof: segments", () => {
		expect(parseDateSnapSegment("startof:week")).toEqual({
			boundary: "start",
			unit: "week",
		});
		expect(parseDateSnapSegment("endof:month")).toEqual({
			boundary: "end",
			unit: "month",
		});
		expect(parseDateSnapSegment("startof:isoweek")).toEqual({
			boundary: "start",
			unit: "isoWeek",
		});
	});

	it("returns null for non-snap segments (so callers keep them literal)", () => {
		expect(parseDateSnapSegment("optional")).toBeNull();
		expect(parseDateSnapSegment("tomorrow")).toBeNull();
		expect(parseDateSnapSegment("MM")).toBeNull();
		// A typo'd key is not a snap — caller renders it literally.
		expect(parseDateSnapSegment("starof:week")).toBeNull();
	});

	it("throws on a snap key with a bad unit", () => {
		expect(() => parseDateSnapSegment("startof:fortnight")).toThrow();
	});
});

describe("applyDateSnap", () => {
	const fmt = (iso: string, boundary: "start" | "end", unit: string) =>
		applyDateSnap(moment(iso), { boundary, unit: unit as never }).format(
			"YYYY-MM-DD HH:mm:ss.SSS",
		);

	it("snaps to the start of the week (locale: Sunday)", () => {
		// Thu 2023-06-01 -> Sun 2023-05-28
		expect(fmt("2023-06-01", "start", "week")).toBe("2023-05-28 00:00:00.000");
	});

	it("snaps to the start of the ISO week (Monday)", () => {
		expect(fmt("2023-06-01", "start", "isoWeek")).toBe(
			"2023-05-29 00:00:00.000",
		);
	});

	it("snaps to start/end of month, quarter, year, day", () => {
		expect(fmt("2023-06-16", "start", "month")).toBe("2023-06-01 00:00:00.000");
		expect(fmt("2023-06-16", "end", "month")).toBe("2023-06-30 23:59:59.999");
		expect(fmt("2023-06-16", "start", "quarter")).toBe(
			"2023-04-01 00:00:00.000",
		);
		expect(fmt("2023-06-16", "start", "year")).toBe("2023-01-01 00:00:00.000");
		expect(fmt("2023-06-16T13:45", "start", "day")).toBe(
			"2023-06-16 00:00:00.000",
		);
		expect(fmt("2023-06-16T13:45", "end", "day")).toBe(
			"2023-06-16 23:59:59.999",
		);
	});

	it("is a no-op when snap is undefined", () => {
		expect(applyDateSnap(moment("2023-06-01"), undefined).format("YYYY-MM-DD")).toBe(
			"2023-06-01",
		);
	});
});
