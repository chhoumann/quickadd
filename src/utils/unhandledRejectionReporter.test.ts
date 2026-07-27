import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerUnhandledRejectionReporter } from "./unhandledRejectionReporter";
import { MacroAbortError } from "../errors/MacroAbortError";
import { promptCancelled } from "../errors/UserCancelError";
import { log } from "../logger/logManager";

/**
 * Errors get attributed to QuickAdd by the `plugin:<id>` marker Obsidian puts in a
 * plugin bundle's stack frames (verified live in Obsidian 1.13.0). Build one, with a
 * controllable throw site so the site-based dedupe can be exercised.
 */
function pluginError(message: string, site = "doThing", name = "Error"): Error {
	const error = new Error(message);
	error.name = name;
	error.stack = `${name}: ${message}\n    at mS.${site} (plugin:quickadd:414:30553)`;
	return error;
}

function foreignError(message: string): Error {
	const error = new Error(message);
	error.stack = `Error: ${message}\n    at x (plugin:some-other-plugin:1:1)`;
	return error;
}

describe("unhandled rejection reporter (#1576)", () => {
	let listener: ((event: PromiseRejectionEvent) => void) | null = null;
	let logError: ReturnType<typeof vi.spyOn>;
	// A hand-cranked clock, injected. Stubbing the global `Date.now` here deadlocks
	// vitest, which reads it for its own timeouts.
	let clock = 1_000_000;

	const host = {
		manifest: { id: "quickadd" },
		registerDomEvent(
			_el: Window,
			_type: "unhandledrejection",
			callback: (event: PromiseRejectionEvent) => void,
		) {
			listener = callback;
		},
	};

	/** A minimal stand-in for PromiseRejectionEvent (jsdom's needs a real promise). */
	function fire(reason: unknown) {
		let defaultPrevented = false;
		listener?.({
			reason,
			preventDefault() {
				defaultPrevented = true;
			},
		} as unknown as PromiseRejectionEvent);
		return { defaultPrevented };
	}

	beforeEach(() => {
		listener = null;
		clock = 1_000_000;
		logError = vi.spyOn(log, "logError").mockImplementation(() => {});
		registerUnhandledRejectionReporter(host, () => clock);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("reports a QuickAdd failure and suppresses the console default", () => {
		const { defaultPrevented } = fire(pluginError("Invalid choice type"));

		expect(defaultPrevented).toBe(true);
		expect(logError).toHaveBeenCalledTimes(1);
		expect(String(logError.mock.calls[0]?.[0])).toContain("Invalid choice type");
	});

	it("leaves another plugin's rejection completely alone", () => {
		const { defaultPrevented } = fire(foreignError("not ours"));

		expect(defaultPrevented).toBe(false);
		expect(logError).not.toHaveBeenCalled();
	});

	it("ignores a rejection it cannot attribute (a bare string has no stack)", () => {
		const { defaultPrevented } = fire("no input given.");

		expect(defaultPrevented).toBe(false);
		expect(logError).not.toHaveBeenCalled();
	});

	it("silences a dismissed prompt instead of reporting it", () => {
		const cancelled = promptCancelled();
		cancelled.stack = "MacroAbortError: x\n    at a (plugin:quickadd:1:1)";

		const { defaultPrevented } = fire(cancelled);

		// Claimed (so the console stays quiet) but never reported.
		expect(defaultPrevented).toBe(true);
		expect(logError).not.toHaveBeenCalled();
	});

	it("silences a deliberate abort", () => {
		const abort = new MacroAbortError("target file missing");
		abort.stack = "MacroAbortError: x\n    at a (plugin:quickadd:1:1)";

		fire(abort);

		expect(logError).not.toHaveBeenCalled();
	});

	it("reports a repeated failure once per window, not once per occurrence", () => {
		// A validator that throws on every keystroke must not bury the user.
		for (let i = 0; i < 20; i++) fire(pluginError("validator exploded"));
		expect(logError).toHaveBeenCalledTimes(1);

		clock += 9_000;
		fire(pluginError("validator exploded"));
		expect(logError).toHaveBeenCalledTimes(1);

		clock += 2_000;
		fire(pluginError("validator exploded"));
		expect(logError).toHaveBeenCalledTimes(2);
	});

	it("collapses one broken loop that fails on many different values", () => {
		// Same throw site, message embeds the note path: one bug, one notice.
		for (let i = 0; i < 200; i++) {
			fire(pluginError(`Could not read note ${i}.md`, "readNote"));
		}
		expect(logError).toHaveBeenCalledTimes(1);
	});

	it("does not let one noisy failure mask a different one", () => {
		fire(pluginError("first", "siteA"));
		fire(pluginError("second", "siteB"));
		fire(pluginError("first", "siteA"));

		expect(logError).toHaveBeenCalledTimes(2);
	});

	it("bounds the dedupe map without wrongly suppressing distinct sites", () => {
		for (let i = 0; i < 200; i++) fire(pluginError("boom", `site${i}`));
		// Every one is a distinct throw site, so every one is a distinct bug.
		expect(logError).toHaveBeenCalledTimes(200);
	});
});
