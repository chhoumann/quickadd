import { describe, expect, it } from "vitest";
import { parseVDateOptions } from "./vdateSyntax";

describe("parseVDateOptions — |startof:/|endof: snap (issue #511)", () => {
	it("extracts a snap and keeps it OUT of the default value", () => {
		const r = parseVDateOptions("startof:week");
		expect(r.snap).toEqual({ boundary: "start", unit: "week" });
		expect(r.defaultValue).toBeUndefined();
	});

	it("supports endof and isoweek", () => {
		expect(parseVDateOptions("endof:month").snap).toEqual({
			boundary: "end",
			unit: "month",
		});
		expect(parseVDateOptions("startof:isoweek").snap).toEqual({
			boundary: "start",
			unit: "isoWeek",
		});
	});

	it("combines with |default, |optional, |time in any order", () => {
		const a = parseVDateOptions("startof:week|next monday|optional");
		expect(a.snap).toEqual({ boundary: "start", unit: "week" });
		expect(a.defaultValue).toBe("next monday");
		expect(a.optional).toBe(true);

		const b = parseVDateOptions("optional|tomorrow|endof:month");
		expect(b.snap).toEqual({ boundary: "end", unit: "month" });
		expect(b.defaultValue).toBe("tomorrow");
		expect(b.optional).toBe(true);

		const c = parseVDateOptions("startof:day|time");
		expect(c.snap).toEqual({ boundary: "start", unit: "day" });
		expect(c.withTime).toBe(true);
	});

	it("preserves a pipe-containing default alongside a snap", () => {
		const r = parseVDateOptions("startof:week|YYYY|MM");
		expect(r.snap).toEqual({ boundary: "start", unit: "week" });
		expect(r.defaultValue).toBe("YYYY|MM");
	});

	it("first snap wins", () => {
		expect(parseVDateOptions("startof:week|endof:month").snap).toEqual({
			boundary: "start",
			unit: "week",
		});
	});

	it("throws on a snap key with an unknown unit", () => {
		expect(() => parseVDateOptions("startof:fortnight")).toThrow();
	});
});

describe("parseVDateOptions — legacy behaviour is unchanged when no snap present", () => {
	const cases = [
		"",
		"optional",
		"tomorrow",
		"tomorrow|optional",
		"optional|tomorrow",
		"time",
		"datetime",
		"type:datetime",
		"next monday|time",
		"YYYY|MM|DD", // pipe-containing default (pinned by vdate-default tests)
		"3:00 pm tomorrow",
	];

	it("does not introduce a snap for any existing option string", () => {
		for (const c of cases) {
			expect(parseVDateOptions(c).snap).toBeUndefined();
		}
	});

	it("keeps defaultValue/optional/withTime identical to pre-snap semantics", () => {
		expect(parseVDateOptions("tomorrow|optional")).toMatchObject({
			defaultValue: "tomorrow",
			optional: true,
			withTime: false,
		});
		expect(parseVDateOptions("YYYY|MM|DD").defaultValue).toBe("YYYY|MM|DD");
		expect(parseVDateOptions("next monday|time")).toMatchObject({
			defaultValue: "next monday",
			withTime: true,
		});
	});
});
