import { describe, expect, it } from "vitest";
import { toError } from "./errorUtils";

describe("toError", () => {
	it("returns the same Error instance when no context is provided", () => {
		const original = new Error("boom");
		expect(toError(original)).toBe(original);
	});

	it("does not mutate the caller's Error when adding context", () => {
		const original = new Error("original");
		const wrapped = toError(original, "ctx");

		// The caller's object is untouched...
		expect(original.message).toBe("original");
		// ...and a new Error carries the prefixed message.
		expect(wrapped).not.toBe(original);
		expect(wrapped.message).toBe("ctx: original");
	});

	it("does not compound prefixes across repeated wrapping of one instance", () => {
		const original = new Error("original");

		// Simulate the same Error flowing through two reporting layers.
		toError(original, "inner");
		const outer = toError(original, "outer");

		expect(original.message).toBe("original");
		expect(outer.message).toBe("outer: original");
	});

	it("preserves the original name and stack when wrapping", () => {
		const original = new TypeError("bad type");
		const wrapped = toError(original, "ctx");

		expect(wrapped.name).toBe("TypeError");
		expect(wrapped.stack).toBe(original.stack);
	});

	it("wraps non-Error values into an Error with optional context", () => {
		expect(toError("plain").message).toBe("plain");
		expect(toError("plain", "ctx").message).toBe("ctx: plain");
		expect(toError(42, "ctx").message).toBe("ctx: 42");
	});
});
