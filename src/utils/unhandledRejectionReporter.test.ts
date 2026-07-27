import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerUnhandledRejectionReporter } from "./unhandledRejectionReporter";
import { ChoiceAbortError } from "../errors/ChoiceAbortError";
import { promptCancelled } from "../errors/UserCancelError";
import { log } from "../logger/logManager";
import { reportError } from "./errorUtils";

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

/**
 * A rejection CONSTRUCTED in another plugin's callback but running inside QuickAdd -
 * the shape #1602 is about. Measured live: another plugin calling
 * `quickadd.api.suggester(v => v.nope.trim(), items)` produces exactly this.
 */
function foreignCallbackInsideQuickAdd(message: string): Error {
	const error = new TypeError(message);
	error.name = "TypeError";
	error.stack = [
		`TypeError: ${message}`,
		"    at eval (plugin:probe-foreign:19:43)",
		"    at eval (plugin:quickadd:88:3004)",
		"    at Array.map (<anonymous>)",
		"    at r.suggester (plugin:quickadd:88:2988)",
		"    at Object.callback (plugin:probe-foreign:19:19)",
		"    at f3 (app://obsidian.md/app.js:1:2995616)",
	].join("\n");
	return error;
}

/**
 * JavaScriptCore's shape. QuickAdd is `isDesktopOnly: false`, and Obsidian mobile runs
 * WKWebView: frames are `fn@url:line:col`, with no `at ` and no `Name: message` header.
 * A frame filter keyed on `at ` would leave the whole reporter dead on iOS with every
 * desktop-shaped test still green.
 */
function jscError(message: string, site = "doThing", plugin = "quickadd"): Error {
	const error = new Error(message);
	error.stack = [
		`${site}@plugin:${plugin}:88:3004`,
		"forEach@[native code]",
	].join("\n");
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

	/**
	 * A minimal stand-in for PromiseRejectionEvent (jsdom's needs a real promise).
	 * Non-optional call on purpose: if the reporter ever stops registering a listener,
	 * the negative tests below would otherwise pass vacuously - a dead listener
	 * produces exactly the values they assert.
	 */
	function fire(reason: unknown) {
		if (!listener) throw new Error("no unhandledrejection listener was registered");
		let defaultPrevented = false;
		listener({
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
		expect(listener, "the reporter must register a listener").not.toBeNull();
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

	// Not every MacroAbortError is a user cancellation. ChoiceAbortError carries copy
	// the user needs ("Selected folder not allowed."), and the rest of the plugin keeps
	// the two apart - so swallowing it here would leave a floated involuntary abort with
	// LESS signal than the console line this replaces.
	it("reports an involuntary abort, which is not a cancellation", () => {
		const abort = new ChoiceAbortError("Selected folder not allowed.");
		abort.stack = "MacroAbortError: x\n    at a (plugin:quickadd:1:1)";

		fire(abort);

		expect(logError).toHaveBeenCalledTimes(1);
		expect(String(logError.mock.calls[0]?.[0])).toContain(
			"Selected folder not allowed.",
		);
	});

	it("reports a repeated failure once per window, not once per occurrence", () => {
		// A validator that throws on every keystroke must not bury the user.
		for (let i = 0; i < 20; i++) fire(pluginError("validator exploded"));
		expect(logError).toHaveBeenCalledTimes(1);

		clock += 9_000;
		fire(pluginError("validator exploded"));
		expect(logError).toHaveBeenCalledTimes(1);
	});

	// The window SLIDES on occurrences, it does not restart on reports. Stamping only
	// on report would let a continuously failing site raise a notice every 10 seconds
	// indefinitely - six 15-second notices a minute, worse than the silence it replaced.
	it("stays quiet while a failure keeps recurring inside the window", () => {
		fire(pluginError("stuck loop"));
		expect(logError).toHaveBeenCalledTimes(1);

		// Failing every 9s for two minutes: still one report.
		for (let i = 0; i < 14; i++) {
			clock += 9_000;
			fire(pluginError("stuck loop"));
		}
		expect(logError).toHaveBeenCalledTimes(1);
	});

	it("reports again once the failure has stopped and recurs", () => {
		fire(pluginError("intermittent"));
		expect(logError).toHaveBeenCalledTimes(1);

		clock += 11_000; // quiet for longer than the window
		fire(pluginError("intermittent"));
		expect(logError).toHaveBeenCalledTimes(2);
	});

	// Silencing the notice must never leave an occurrence with LESS evidence than
	// before this reporter existed, so a suppressed repeat keeps the browser's own
	// unhandled-rejection line.
	it("leaves the browser default alone for a suppressed repeat", () => {
		expect(fire(pluginError("noisy")).defaultPrevented).toBe(true);
		expect(fire(pluginError("noisy")).defaultPrevented).toBe(false);
	});

	it("collapses one broken loop that fails on many different values", () => {
		// Same throw site, message embeds the note path: one bug, one notice.
		for (let i = 0; i < 200; i++) {
			fire(pluginError(`Could not read note ${i}.md`, "readNote"));
		}
		expect(logError).toHaveBeenCalledTimes(1);
	});

	// `plugin:quickadd` is a PREFIX of `plugin:quickadd-beta`, so an undelimited match
	// would claim a fork's rejections and suppress their only console line.
	it("does not claim a plugin whose id merely starts with ours", () => {
		const error = new Error("beta bug");
		error.stack = "Error: beta bug\n    at f (plugin:quickadd-beta:1:1)";

		const { defaultPrevented } = fire(error);

		expect(defaultPrevented).toBe(false);
		expect(logError).not.toHaveBeenCalled();
	});

	// `Error.stack` is captured at construction with the WHOLE live call stack, so "any
	// frame is ours" claimed a foreign caller's bug the moment it ran through QuickAdd -
	// and preventDefault() took away the console line naming the real culprit (#1602).
	it("does not claim a foreign callback's bug that merely ran inside QuickAdd", () => {
		const { defaultPrevented } = fire(
			foreignCallbackInsideQuickAdd("Cannot read properties of undefined"),
		);

		expect(defaultPrevented).toBe(false);
		expect(logError).not.toHaveBeenCalled();
	});

	// The mirror: OUR bug, called into by another plugin. The construction frame is ours,
	// so it is still reported even though a foreign frame sits below it.
	it("still claims a QuickAdd bug reached through another plugin", () => {
		const error = new Error("Choice not found");
		error.stack = [
			"Error: Choice not found",
			"    at mS.getChoiceByName (plugin:quickadd:414:30553)",
			"    at Object.callback (plugin:probe-foreign:19:19)",
		].join("\n");

		fire(error);

		expect(logError).toHaveBeenCalledTimes(1);
	});

	// An eval'd frame names the bundle as an ORIGIN, with no :line:col - which is how a
	// user script's own code and a dataviewjs snippet appear. Requiring a position would
	// skip straight past them to the QuickAdd frame underneath and mis-claim the bug.
	it("attributes an eval'd frame to the bundle that evaluated it", () => {
		const error = new TypeError("x.nope is not a function");
		error.name = "TypeError";
		error.stack = [
			"TypeError: x.nope is not a function",
			"    at eval (eval at <anonymous> (plugin:dataview), <anonymous>:3:47)",
			"    at r.suggester (plugin:quickadd:88:2988)",
		].join("\n");

		const { defaultPrevented } = fire(error);

		expect(defaultPrevented).toBe(false);
		expect(logError).not.toHaveBeenCalled();
	});

	// A message is part of `stack` on V8, so without stripping the header an Error could
	// name a plugin in its own text and dictate who gets blamed.
	it("ignores a plugin name that appears only in the message", () => {
		const error = new Error("could not reach plugin:some-other-plugin:1:1");
		error.stack = [
			"Error: could not reach plugin:some-other-plugin:1:1",
			"    at mS.fetchThing (plugin:quickadd:414:30553)",
		].join("\n");

		fire(error);

		expect(logError).toHaveBeenCalledTimes(1);
	});

	// Obsidian mobile is JavaScriptCore. QuickAdd ships there (isDesktopOnly: false), so
	// attribution must not assume V8's `    at fn (url)` frame syntax.
	it("attributes a JavaScriptCore stack, which has no `at ` frames", () => {
		fire(jscError("mobile bug"));

		expect(logError).toHaveBeenCalledTimes(1);
	});

	it("leaves another plugin alone on a JavaScriptCore stack too", () => {
		const { defaultPrevented } = fire(
			jscError("not ours", "theirThing", "some-other-plugin"),
		);

		expect(defaultPrevented).toBe(false);
		expect(logError).not.toHaveBeenCalled();
	});

	// #1601: reportError drops a failure a lower layer already showed the user. Claiming
	// the event anyway would take the console's async trace away and put nothing in its
	// place - strictly less evidence than before this reporter existed.
	it("leaves the browser default alone when the failure was already reported", () => {
		const error = pluginError("reported downstream");
		reportError(error, "an inner layer");
		logError.mockClear();

		const { defaultPrevented } = fire(error);

		expect(logError).not.toHaveBeenCalled();
		expect(defaultPrevented).toBe(false);
	});

	it("does not let one noisy failure mask a different one", () => {
		fire(pluginError("first", "siteA"));
		fire(pluginError("second", "siteB"));
		fire(pluginError("first", "siteA"));

		expect(logError).toHaveBeenCalledTimes(2);
	});

	it("reports every distinct throw site, however many there are", () => {
		for (let i = 0; i < 200; i++) fire(pluginError("boom", `site${i}`));
		expect(logError).toHaveBeenCalledTimes(200);
	});

	// The map is bounded (MAX_TRACKED), so past that many LIVE sites the "one report
	// per site per window" guarantee degrades to reporting again. That is the deliberate
	// trade against unbounded growth; pin it so the behaviour is a decision, not a
	// surprise. Fewer sites than the bound must still collapse within the window.
	it("keeps collapsing a repeat while the site is still tracked", () => {
		for (let i = 0; i < 10; i++) fire(pluginError("boom", `site${i}`));
		expect(logError).toHaveBeenCalledTimes(10);

		fire(pluginError("boom", "site0"));
		expect(logError).toHaveBeenCalledTimes(10);
	});

	it("evicts under pressure rather than growing without limit", () => {
		// Far more live sites than the bound; the oldest entries get dropped, so an
		// early site is reported a second time instead of being remembered forever.
		for (let i = 0; i < 200; i++) fire(pluginError("boom", `site${i}`));
		logError.mockClear();
		fire(pluginError("boom", "site0"));
		expect(logError).toHaveBeenCalledTimes(1);
	});

	// Eviction must never drop the key it just stamped, or the site currently failing
	// would report on every single occurrence.
	it("does not evict the site it is currently handling", () => {
		for (let i = 0; i < 200; i++) fire(pluginError("boom", `site${i}`));
		logError.mockClear();
		fire(pluginError("boom", "hot"));
		expect(logError).toHaveBeenCalledTimes(1);
		fire(pluginError("boom", "hot"));
		expect(logError).toHaveBeenCalledTimes(1);
	});
});
