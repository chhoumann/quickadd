import { describe, expect, it } from "vitest";
import { parseVDateOptions } from "./vdateSyntax";

describe("parseVDateOptions (issue #1259)", () => {
	it("returns no default and not-optional for empty input", () => {
		expect(parseVDateOptions(undefined)).toEqual({ optional: false });
		expect(parseVDateOptions(null)).toEqual({ optional: false });
		expect(parseVDateOptions("")).toEqual({ optional: false });
	});

	it("treats a plain segment as the legacy default", () => {
		expect(parseVDateOptions("tomorrow")).toEqual({
			defaultValue: "tomorrow",
			optional: false,
		});
	});

	it("recognizes the bare optional flag", () => {
		expect(parseVDateOptions("optional")).toEqual({
			defaultValue: undefined,
			optional: true,
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
		});
		expect(parseVDateOptions("optional|tomorrow")).toEqual({
			defaultValue: "tomorrow",
			optional: true,
		});
	});

	it("supports the keyed optional:<bool> form, which wins over the bare flag", () => {
		expect(parseVDateOptions("optional:true").optional).toBe(true);
		expect(parseVDateOptions("optional:false|tomorrow")).toEqual({
			defaultValue: "tomorrow",
			optional: false,
		});
		expect(parseVDateOptions("optional|optional:false").optional).toBe(
			false,
		);
	});

	it("rejoins non-flag parts verbatim so pipes in defaults survive", () => {
		expect(parseVDateOptions("a|optional|b")).toEqual({
			defaultValue: "a|b",
			optional: true,
		});
	});
});
