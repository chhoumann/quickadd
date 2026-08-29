import realMoment from "moment";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDate } from "./dates";

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

describe("getDate origin — calendar day plus wall-clock time", () => {
	beforeEach(() => freeze("2026-08-26T15:30:00"));

	const lastFriday = new Date(2026, 7, 21);

	it("formats the origin day when only a date is requested", () => {
		expect(getDate({ format: "YYYY-MM-DD", origin: lastFriday })).toBe(
			"2026-08-21",
		);
	});

	it("keeps the wall-clock time when the format is a clock", () => {
		expect(getDate({ format: "HH:mm", origin: lastFriday })).toBe("15:30");
	});

	it("joins origin day and wall-clock time in a combined format", () => {
		expect(getDate({ format: "YYYY-MM-DD HH:mm", origin: lastFriday })).toBe(
			"2026-08-21 15:30",
		);
	});

	it("applies +N days to the origin, not to today", () => {
		expect(
			getDate({ format: "YYYY-MM-DD", origin: lastFriday, offset: 1 }),
		).toBe("2026-08-22");
		expect(
			getDate({ format: "YYYY-MM-DD", origin: lastFriday, offset: -1 }),
		).toBe("2026-08-20");
	});

	it("snaps the origin week, not today's week", () => {
		expect(
			getDate({
				format: "YYYY-MM-DD",
				origin: lastFriday,
				snap: { boundary: "start", unit: "week" },
			}),
		).toBe("2026-08-16");
	});

	it("lets an explicit now override the wall clock without changing the origin day", () => {
		const morning = new Date(2026, 7, 26, 9, 5, 0);
		expect(
			getDate({
				format: "YYYY-MM-DD HH:mm",
				origin: lastFriday,
				now: morning,
			}),
		).toBe("2026-08-21 09:05");
	});

	it("uses now alone when no origin is set (TIME path)", () => {
		const morning = new Date(2026, 7, 26, 9, 5, 0);
		expect(getDate({ format: "HH:mm", now: morning })).toBe("09:05");
		expect(getDate({ format: "YYYY-MM-DD", now: morning })).toBe("2026-08-26");
	});

	it("defaults to today when origin is omitted", () => {
		expect(getDate({ format: "YYYY-MM-DD" })).toBe("2026-08-26");
		expect(getDate({ format: "HH:mm" })).toBe("15:30");
	});
});
