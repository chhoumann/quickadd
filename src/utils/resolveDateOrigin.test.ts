import realMoment from "moment";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	addCalendarOffset,
	applyInvocationDate,
	dateFromStoredValue,
	planDateOrigin,
} from "./resolveDateOrigin";

const originalMoment = (window as unknown as { moment?: unknown }).moment;

beforeAll(() => {
	(window as unknown as { moment: unknown }).moment = realMoment;
});
afterAll(() => {
	(window as unknown as { moment?: unknown }).moment = originalMoment;
	vi.useRealTimers();
});
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-08-26T15:30:00"));
});

describe("addCalendarOffset", () => {
	it("moves by week and month from the frozen now", () => {
		const now = new Date("2026-08-26T15:30:00");
		expect(addCalendarOffset(now, -1, "weeks").toISOString().startsWith("2026-08-19")).toBe(
			true,
		);
		expect(addCalendarOffset(now, 1, "years").getFullYear()).toBe(2027);
	});
});

describe("dateFromStoredValue", () => {
	it("reads @date, Date, and natural-language aliases", () => {
		expect(dateFromStoredValue(new Date(2026, 7, 21))?.getDate()).toBe(21);
		expect(
			dateFromStoredValue("@date:2026-08-21T00:00:00.000Z") instanceof Date,
		).toBe(true);
		expect(dateFromStoredValue("lw")).toBeInstanceOf(Date);
		expect(dateFromStoredValue("")).toBeUndefined();
	});

	it("rejects an invalid Date and unparseable text", () => {
		expect(dateFromStoredValue(new Date("bad"))).toBeUndefined();
		expect(dateFromStoredValue("not-a-date-xyz")).toBeUndefined();
	});
});

describe("planDateOrigin", () => {
	const now = new Date("2026-08-26T15:30:00");

	it("inherits when a date is already on the run", () => {
		expect(
			planDateOrigin({
				setting: { kind: "ask" },
				clocks: { now, date: new Date(2026, 7, 21) },
			}),
		).toEqual({ status: "inherit" });
	});

	it("inherits today when the setting is missing or now", () => {
		expect(planDateOrigin({ clocks: { now } })).toEqual({ status: "inherit" });
		expect(
			planDateOrigin({ setting: { kind: "now" }, clocks: { now } }),
		).toEqual({ status: "inherit" });
	});

	it("plans ask and relative", () => {
		expect(
			planDateOrigin({
				setting: { kind: "ask", defaultValue: "lw" },
				clocks: { now },
			}),
		).toEqual({ status: "ask", defaultValue: "lw" });

		const planned = planDateOrigin({
			setting: { kind: "relative", offset: -1, unit: "weeks" },
			clocks: { now },
		});
		expect(planned.status).toBe("set");
		if (planned.status === "set") {
			expect(planned.date.getDate()).toBe(19);
		}
	});

	it("reads a variable and a reserved seed", () => {
		const variables = new Map<string, unknown>([
			["day", "@date:2026-08-21T00:00:00.000Z"],
		]);
		const fromVar = planDateOrigin({
			setting: { kind: "variable", name: "day" },
			clocks: { now },
			variables,
		});
		expect(fromVar.status).toBe("set");

		const fromSeed = planDateOrigin({
			setting: { kind: "ask" },
			clocks: { now },
			reservedSeed: "@date:2026-08-21T00:00:00.000Z",
		});
		expect(fromSeed.status).toBe("set");
	});

	it("errors when the variable is missing", () => {
		expect(
			planDateOrigin({
				setting: { kind: "variable", name: "day" },
				clocks: { now },
				variables: new Map(),
			}).status,
		).toBe("error");
	});
});

describe("applyInvocationDate", () => {
	it("treats ask as pickDate and leaves clocks unset", () => {
		const executor: { clocks?: { now: Date; date?: Date }; pickDate?: boolean } =
			{};
		expect(applyInvocationDate(executor, "ask")).toBe(true);
		expect(executor.pickDate).toBe(true);
		expect(executor.clocks).toBeUndefined();
	});

	it("parses a concrete day onto clocks", () => {
		const executor: { clocks?: { now: Date; date?: Date }; pickDate?: boolean } =
			{};
		expect(applyInvocationDate(executor, "2026-08-21")).toBe(true);
		expect(executor.pickDate).toBeUndefined();
		expect(executor.clocks?.date).toBeInstanceOf(Date);
	});

	it("rejects an unreadable value", () => {
		expect(applyInvocationDate({}, "not-a-day")).toBe(false);
	});
});
