import { describe, expect, it } from "vitest";
import { normalizeDateOrigin } from "./dateOrigin";

describe("normalizeDateOrigin", () => {
	it("accepts each kind", () => {
		expect(normalizeDateOrigin({ kind: "now" })).toEqual({ kind: "now" });
		expect(normalizeDateOrigin({ kind: "ask" })).toEqual({ kind: "ask" });
		expect(
			normalizeDateOrigin({ kind: "ask", defaultValue: " last week " }),
		).toEqual({ kind: "ask", defaultValue: "last week" });
		expect(
			normalizeDateOrigin({ kind: "relative", offset: -1, unit: "weeks" }),
		).toEqual({ kind: "relative", offset: -1, unit: "weeks" });
		expect(normalizeDateOrigin({ kind: "variable", name: " day " })).toEqual({
			kind: "variable",
			name: "day",
		});
	});

	it("rejects illegal combinations", () => {
		expect(normalizeDateOrigin(undefined)).toBeUndefined();
		expect(normalizeDateOrigin({ kind: "relative", offset: 1.5, unit: "weeks" })).toBeUndefined();
		expect(normalizeDateOrigin({ kind: "relative", offset: -1, unit: "hours" })).toBeUndefined();
		expect(normalizeDateOrigin({ kind: "variable", name: "" })).toBeUndefined();
		expect(normalizeDateOrigin({ kind: "prompt" })).toBeUndefined();
	});
});
