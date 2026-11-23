import { isCancellationError, reportError } from "./errorUtils";

/**
 * Reports a promise rejection that escaped QuickAdd unhandled instead of letting
 * it die in the console. One seam covers floated handlers a per-handler wrapper
 * cannot reach (Svelte props, `void` calls); the notice has no per-action context.
 */

/**
 * Suppress a repeat of the same failure for this long. Some floated calls run on
 * every keystroke or vault change.
 */
const REPEAT_WINDOW_MS = 10_000;
/** Bound the dedupe map so a pathological run cannot grow it without limit. */
const MAX_TRACKED = 50;

interface UnhandledRejectionReporterHost {
	manifest: { id: string };
	registerDomEvent(
		el: Window,
		type: "unhandledrejection",
		callback: (event: PromiseRejectionEvent) => void,
	): void;
}

/**
 * Obsidian evaluates a plugin bundle with the sourceURL `plugin:<id>`. No
 * trailing `:<line>:<col>` is required, since eval'd frames (user scripts,
 * dataviewjs) carry the bundle with no position. The class stops at `:` and `)`,
 * so `quickadd-beta` is not read as `quickadd`.
 */
const PLUGIN_FRAME = /plugin:([^\s:)]+)/;

/**
 * The frames of a stack without the `Name: message` header. V8 puts the message
 * inside `stack`; filtering on `at ` instead would break on JavaScriptCore
 * (Obsidian mobile), whose frames are `fn@url:line:col` with no header.
 */
function stackFrames(error: Error): string[] {
	const stack = error.stack ?? "";
	const header = `${error.name}: ${error.message}`;
	const body = stack.startsWith(header) ? stack.slice(header.length) : stack;
	return body.split("\n");
}

/**
 * The topmost frame naming a plugin bundle, which decides whose bug this is.
 * Matching any frame would claim another plugin's error thrown inside a callback
 * QuickAdd invoked. A rejection with no plugin frame or no stack is left alone.
 */
function attributingFrame(
	error: Error,
): { pluginId: string; frame: string } | null {
	for (const line of stackFrames(error)) {
		const match = PLUGIN_FRAME.exec(line);
		if (match) return { pluginId: match[1], frame: line.trim() };
	}
	return null;
}

/** Dedupe on the throw site, not the message, which often embeds a varying value. */
function dedupeKey(error: Error, frame: string): string {
	return `${error.name}@${frame}`;
}

export function registerUnhandledRejectionReporter(
	plugin: UnhandledRejectionReporterHost,
	/**
	 * Injected so the dedupe window can be tested without stubbing the global
	 * `Date.now` - vitest itself reads it for timeouts, and freezing it deadlocks the
	 * runner.
	 */
	now: () => number = Date.now,
): void {
	const pluginId = plugin.manifest.id;
	const recentlySeen = new Map<string, number>();

	plugin.registerDomEvent(window, "unhandledrejection", (event) => {
		const reason = event.reason;
		const attribution =
			reason instanceof Error ? attributingFrame(reason) : null;
		if (attribution?.pluginId !== pluginId) return;

		// A dismissed prompt is not a failure. This is a backstop: `dev:errors`
		// records the rejection before this listener runs, so code that floats a
		// prompt should catch the dismissal itself. Only user cancellations are
		// silenced; a ChoiceAbortError carries copy the user needs.
		if (isCancellationError(reason)) {
			event.preventDefault();
			return;
		}

		const error = reason as Error;
		const key = dedupeKey(error, attribution.frame);
		const at = now();
		const last = recentlySeen.get(key);
		// Stamp every OCCURRENCE, not every report. Stamping only on report restarts
		// the window each time, so a site failing continuously would raise a notice
		// every REPEAT_WINDOW_MS forever; stamping here makes the window slide, so a
		// sustained failure reports once and then stays quiet until it stops and recurs.
		recentlySeen.set(key, at);
		if (last !== undefined && at - last < REPEAT_WINDOW_MS) {
			// Deliberately NOT preventDefault: a suppressed repeat keeps the browser's
			// own unhandled-rejection line, so silencing the notice never leaves the
			// occurrence with less evidence than before this reporter existed.
			return;
		}

		if (recentlySeen.size >= MAX_TRACKED) {
			for (const [tracked, seenAt] of recentlySeen) {
				if (at - seenAt >= REPEAT_WINDOW_MS) recentlySeen.delete(tracked);
			}
			// Still full: every entry is fresh, so drop the oldest to make room.
			if (recentlySeen.size >= MAX_TRACKED) {
				const oldest = recentlySeen.keys().next();
				if (!oldest.done && oldest.value !== key) {
					recentlySeen.delete(oldest.value);
				}
			}
		}

		// Claim the event only if a notice went out; preventDefault without one
		// would drop the browser's async trace and put nothing in its place.
		if (reportError(error, "A QuickAdd action failed")) {
			event.preventDefault();
		}
	});
}
