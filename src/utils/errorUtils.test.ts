import { afterEach, describe, expect, it, vi } from "vitest";
import { log } from "../logger/logManager";
import {
	reportError,
	reportUnlessCancelled,
	reportingHandler,
	toError,
} from "./errorUtils";
import { promptCancelled } from "../errors/UserCancelError";

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

/**
 * #1601. One user-script failure produced TWO 15-second notices, because
 * MacroChoiceEngine reports and re-throws and the command handler reports again. Both
 * layers are right to report - neither can know whether anything above it will - so
 * report-once lives in the function they both call.
 */
describe("reportError reports each failure once", () => {
	const spyOnLogError = () =>
		vi.spyOn(log, "logError").mockImplementation(() => {});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("reports the same Error instance once, however many layers report it", () => {
		const logError = spyOnLogError();
		const failure = new Error("Cannot read properties of undefined");

		expect(reportError(failure, "Failed to run user script probe.js")).toBe(true);
		expect(reportError(failure, "Error executing choice probe-1601")).toBe(false);

		expect(logError).toHaveBeenCalledTimes(1);
		// The INNER layer wins: it is the one that knows which script failed.
		expect((logError.mock.calls[0][0] as Error).message).toBe(
			"Failed to run user script probe.js: Cannot read properties of undefined",
		);
	});

	// Keyed on identity, not text: a loop that fails on 200 notes with the same sentence
	// is 200 failures, and each still deserves its own report.
	it("reports two distinct failures that happen to read the same", () => {
		const logError = spyOnLogError();

		reportError(new Error("boom"), "ctx");
		reportError(new Error("boom"), "ctx");

		expect(logError).toHaveBeenCalledTimes(2);
	});

	// Not every layer re-throws the same instance: the AI request path reports the
	// provider error and throws a wrapper carrying it as `cause`.
	it("suppresses a wrapper whose cause was already reported", () => {
		const logError = spyOnLogError();
		const cause = new Error("429 rate limited");

		reportError(cause);
		reportError(new Error("Error while making request to OpenAI", { cause }));

		expect(logError).toHaveBeenCalledTimes(1);
	});

	// Suppression has to EXPIRE. A long-lived user-script module that re-throws one
	// cached Error on every invocation would otherwise be reported the first time and
	// then be silent forever - a command that does nothing, which is the failure the
	// whole reporting seam exists to remove.
	it("reports the same instance again on a later, independent run", () => {
		const logError = spyOnLogError();
		const cached = new Error("config missing");

		vi.useFakeTimers({ toFake: ["Date"] });
		try {
			vi.setSystemTime(new Date("2026-07-27T12:00:00Z"));
			expect(reportError(cached, "first run")).toBe(true);
			expect(reportError(cached, "same propagation")).toBe(false);

			// A minute later the user runs the command again.
			vi.setSystemTime(new Date("2026-07-27T12:01:00Z"));
			expect(reportError(cached, "second run")).toBe(true);
		} finally {
			vi.useRealTimers();
		}

		expect(logError).toHaveBeenCalledTimes(2);
	});

	it("survives a cyclic cause chain", () => {
		spyOnLogError();
		const a = new Error("a") as Error & { cause?: unknown };
		const b = new Error("b") as Error & { cause?: unknown };
		a.cause = b;
		b.cause = a;

		expect(() => reportError(a)).not.toThrow();
	});

	// A WeakSet cannot hold a primitive, and MacroChoiceEngine really is handed whatever
	// a user script threw - including a bare string. Those keep the old behaviour rather
	// than silently changing it.
	it("cannot dedupe a non-object rejection, and says so by reporting twice", () => {
		const logError = spyOnLogError();

		reportError("a script threw a string", "inner");
		reportError("a script threw a string", "outer");

		expect(logError).toHaveBeenCalledTimes(2);
	});
});

/**
 * PR #1606's first rule at the outermost handlers: pressing Escape on the one-page input
 * modal raised `(ERROR) Error executing choice <uuid>: One-page input cancelled by user`
 * - a 15-second red notice for a deliberate dismissal.
 */
describe("reportUnlessCancelled", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("stays silent for a dismissal", () => {
		const logError = vi.spyOn(log, "logError").mockImplementation(() => {});

		expect(reportUnlessCancelled(promptCancelled(), "Could not run \"Daily note\"")).toBe(
			false,
		);
		expect(logError).not.toHaveBeenCalled();
	});

	it("reports a genuine failure", () => {
		const logError = vi.spyOn(log, "logError").mockImplementation(() => {});

		expect(
			reportUnlessCancelled(new Error("Template file not found"), "Could not run it"),
		).toBe(true);
		expect(logError).toHaveBeenCalledTimes(1);
	});
});
