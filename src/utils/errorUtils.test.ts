import { afterEach, describe, expect, it, vi } from "vitest";
import { log } from "../logger/logManager";
import { reportingHandler, toError } from "./errorUtils";

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

/**
 * #1585. Svelte re-throws event-handler errors to the window and an `async`
 * handler's rejection is an unhandled rejection, so a failing row action was a
 * button that simply did nothing - no Notice, no message the user would look for.
 */
describe("reportingHandler", () => {
	const spyOnLogError = () =>
		vi.spyOn(log, "logError").mockImplementation(() => {});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("passes arguments through and returns nothing on the happy path", () => {
		const logError = spyOnLogError();
		const fn = vi.fn();

		reportingHandler("Couldn't delete that choice", fn)("a", 2);

		expect(fn).toHaveBeenCalledWith("a", 2);
		expect(logError).not.toHaveBeenCalled();
	});

	it("reports a synchronous throw instead of letting it reach the window", () => {
		const logError = spyOnLogError();
		const wrapped = reportingHandler("Couldn't delete that choice", () => {
			throw new Error("Invalid choice type");
		});

		expect(() => wrapped()).not.toThrow();
		expect((logError.mock.calls[0][0] as Error).message).toBe(
			"Couldn't delete that choice: Invalid choice type",
		);
	});

	it("reports a rejected promise instead of an unhandled rejection", async () => {
		const logError = spyOnLogError();
		const wrapped = reportingHandler("Couldn't duplicate that choice", () =>
			Promise.reject(new Error("boom")),
		);

		wrapped();
		await Promise.resolve();

		expect((logError.mock.calls[0][0] as Error).message).toBe(
			"Couldn't duplicate that choice: boom",
		);
	});

	// A thenable is only required to have `.then`. Calling `.catch` on one directly
	// reports "result.catch is not a function" INSTEAD of the real failure — which
	// is the same lost error this helper exists to prevent, so assert the cause.
	it("reports the real rejection of a thenable that is not a native promise", async () => {
		const logError = spyOnLogError();
		const wrapped = reportingHandler("Couldn't move that choice", () => ({
			then: (_ok: unknown, fail: (err: unknown) => void) => fail(new Error("boom")),
		}));

		wrapped();
		await Promise.resolve();
		await Promise.resolve();

		expect(logError).toHaveBeenCalledTimes(1);
		expect((logError.mock.calls[0][0] as Error).message).toBe(
			"Couldn't move that choice: boom",
		);
	});

	it("stays quiet for a cancelled prompt, which is an answer and not a failure", async () => {
		const logError = spyOnLogError();

		// The exact rejection GenericInputPrompt uses when the user presses Escape.
		reportingHandler("Couldn't rename that choice", () =>
			Promise.reject("No input given."),
		)();
		reportingHandler("Couldn't rename that choice", () => {
			throw "no input given.";
		})();
		await Promise.resolve();

		expect(logError).not.toHaveBeenCalled();
	});

	it("does not treat a non-promise return value as a promise", () => {
		const logError = spyOnLogError();

		expect(() => reportingHandler("ctx", () => 0)()).not.toThrow();
		expect(() => reportingHandler("ctx", () => null)()).not.toThrow();
		expect(() => reportingHandler("ctx", () => "done")()).not.toThrow();
		expect(logError).not.toHaveBeenCalled();
	});
});
