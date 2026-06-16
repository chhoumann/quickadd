import { describe, expect, it } from "vitest";
import { parseVDateOptions } from "./vdateSyntax";

describe("parseVDateOptions (issue #1259)", () => {
	it("returns no default and not-optional for empty input", () => {
		expect(parseVDateOptions(undefined)).toEqual({
			optional: false,
			withTime: false,
		});
		expect(parseVDateOptions(null)).toEqual({
			optional: false,
			withTime: false,
		});
		expect(parseVDateOptions("")).toEqual({
			optional: false,
			withTime: false,
		});
	});

	it("treats a plain segment as the legacy default", () => {
		expect(parseVDateOptions("tomorrow")).toEqual({
			defaultValue: "tomorrow",
			optional: false,
			withTime: false,
		});
	});

	it("recognizes the bare optional flag", () => {
		expect(parseVDateOptions("optional")).toEqual({
			defaultValue: undefined,
			optional: true,
			withTime: false,
		});
	});

	it("is case-insensitive and trims whitespace", () => {
		expect(parseVDateOptions(" Optional ").optional).toBe(true);
		expect(parseVDateOptions("OPTIONAL").optional).toBe(true);
	});

	it("is order-insensitive with a default", () => {
		expect(parseVDateOptions("tomorrow|optional")).toEqual({
			defaultValue: "tomorrow",
			optional: true,
			withTime: false,
		});
		expect(parseVDateOptions("optional|tomorrow")).toEqual({
			defaultValue: "tomorrow",
			optional: true,
			withTime: false,
		});
	});

	it("supports the keyed optional:<bool> form, which wins over the bare flag", () => {
		expect(parseVDateOptions("optional:true").optional).toBe(true);
		expect(parseVDateOptions("optional:false|tomorrow")).toEqual({
			defaultValue: "tomorrow",
			optional: false,
			withTime: false,
		});
		expect(parseVDateOptions("optional|optional:false").optional).toBe(
			false,
		);
	});

	it("rejoins non-flag parts verbatim so pipes in defaults survive", () => {
		expect(parseVDateOptions("a|optional|b")).toEqual({
			defaultValue: "a|b",
			optional: true,
			withTime: false,
		});
	});
});

describe("parseVDateOptions withTime (issue #757)", () => {
	it("recognizes the bare |time flag", () => {
		expect(parseVDateOptions("time").withTime).toBe(true);
	});

	it("recognizes |datetime and |type:datetime", () => {
		expect(parseVDateOptions("datetime").withTime).toBe(true);
		expect(parseVDateOptions("type:datetime").withTime).toBe(true);
	});

	it("defaults withTime to false and keeps date-only output byte-identical", () => {
		expect(parseVDateOptions("tomorrow").withTime).toBe(false);
		expect(parseVDateOptions("type:date").withTime).toBe(false);
	});

	it("does NOT leak a keyed |type: control flag into the default", () => {
		expect(parseVDateOptions("tomorrow|type:datetime")).toEqual({
			defaultValue: "tomorrow",
			optional: false,
			withTime: true,
		});
		expect(parseVDateOptions("type:date").defaultValue).toBeUndefined();
	});

	it("is order-insensitive and composes with optional + default", () => {
		expect(parseVDateOptions("tomorrow at 3pm|time|optional")).toEqual({
			defaultValue: "tomorrow at 3pm",
			optional: true,
			withTime: true,
		});
		expect(parseVDateOptions("optional|datetime|next friday")).toEqual({
			defaultValue: "next friday",
			optional: true,
			withTime: true,
		});
	});
});
