import { describe, it, expect } from "vitest";
import {
	formatDateAliasInline,
	formatDateAliasLines,
	getOrderedDateAliases,
	normalizeDateInput,
	parseDateAliasLines,
} from "./dateAliases";

describe("dateAliases", () => {
	it("normalizes direct aliases", () => {
		const result = normalizeDateInput("tm", { tm: "tomorrow" });
		expect(result).toBe("tomorrow");
	});

	it("normalizes aliases in the first token", () => {
		const result = normalizeDateInput("tm 5pm", { tm: "tomorrow" });
		expect(result).toBe("tomorrow 5pm");
	});

	it("leaves non-alias input untouched", () => {
		const result = normalizeDateInput("next friday", { tm: "tomorrow" });
		expect(result).toBe("next friday");
	});

	it("does not resolve Object.prototype members as aliases", () => {
		// A bare bracket lookup on the plain-object alias map walked the
		// prototype chain: "constructor" resolved to the Object function (a
		// truthy non-string) instead of falling through to the raw input.
		expect(normalizeDateInput("constructor", { tm: "tomorrow" })).toBe(
			"constructor",
		);
		expect(normalizeDateInput("__proto__", { tm: "tomorrow" })).toBe(
			"__proto__",
		);
		expect(normalizeDateInput("constructor 5pm", { tm: "tomorrow" })).toBe(
			"constructor 5pm",
		);
	});

	it("still resolves a user-defined alias that shadows a magic name", () => {
		expect(
			normalizeDateInput("constructor", { constructor: "tomorrow" }),
		).toBe("tomorrow");
	});

	it("round-trips a '__proto__' alias line through parse and lookup", () => {
		// The old `result[key] = value` write hit the Object.prototype accessor
		// for this key: no own property was created and the alias silently
		// vanished from the settings textarea on the next open.
		const parsed = parseDateAliasLines("__proto__ = tomorrow");
		expect(Object.prototype.hasOwnProperty.call(parsed, "__proto__")).toBe(
			true,
		);
		expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
		expect(formatDateAliasLines(parsed)).toBe("__proto__ = tomorrow");
		expect(normalizeDateInput("__proto__", parsed)).toBe("tomorrow");
	});

	it("parses alias lines into a map", () => {
		const parsed = parseDateAliasLines("tm = tomorrow\n# comment\nyd=yesterday");
		expect(parsed).toEqual({ tm: "tomorrow", yd: "yesterday" });
	});

	it("formats aliases back into lines", () => {
		const formatted = formatDateAliasLines({
			tm: "tomorrow",
			yd: "yesterday",
		});
		expect(formatted).toBe("tm = tomorrow\nyd = yesterday");
	});

	it("orders aliases with preferred keys first", () => {
		const ordered = getOrderedDateAliases({
			foo: "bar",
			tm: "tomorrow",
			yd: "yesterday",
			t: "today",
		});
		expect(ordered[0][0]).toBe("t");
		expect(ordered[1][0]).toBe("tm");
	});

	it("formats aliases inline", () => {
		const summary = formatDateAliasInline({
			tm: "tomorrow",
			yd: "yesterday",
		});
		expect(summary).toContain("tm=tomorrow");
	});
});
