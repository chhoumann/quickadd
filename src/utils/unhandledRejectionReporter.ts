import { isCancellationError, reportError } from "./errorUtils";

/**
 * Reports a promise rejection that escaped QuickAdd unhandled, instead of letting it
 * die in the console.
 *
 * Across `src/` there are roughly forty `onClick(async …)` / `onclick={…}` handlers that
 * hand Obsidian or Svelte a promise it discards, plus a long tail of deliberately
 * fire-and-forget `void someAsyncCall()`. When one of those fails the user gets nothing:
 * no notice, no entry in QuickAdd's error log, only an `Uncaught (in promise) …` line
 * they will never see. Clicking the gear on a choice whose `type` is corrupt, for
 * instance, threw `Invalid choice type` and simply did nothing (#1576).
 *
 * This is one seam instead of forty `try/catch` blocks. A per-handler wrapper is exactly
 * the boilerplate #1567 failed to converge on: it cannot cover Svelte prop handlers or
 * floated calls, and it rots the moment someone adds handler forty-one. The trade-off
 * accepted is that the notice carries no per-action context, only the error itself.
 */

/**
 * Suppress a repeat of the same failure for this long. Several of the floated calls run
 * at high frequency - a validator on every keystroke, a reindex on every vault change,
 * a Svelte unmount on every modal close - so without this a single broken one would bury
 * the user under 15-second notices.
 */
const REPEAT_WINDOW_MS = 10_000;
/** Bound the dedupe map so a pathological run cannot grow it without limit. */
const MAX_TRACKED = 50;

export interface UnhandledRejectionReporterHost {
	manifest: { id: string };
	registerDomEvent(
		el: Window,
		type: "unhandledrejection",
		callback: (event: PromiseRejectionEvent) => void,
	): void;
}

/**
 * Obsidian evaluates a plugin's `main.js` with a `sourceURL` of `plugin:<id>`, so a
 * frame inside a plugin bundle names it: `at mS.getChoiceByName (plugin:quickadd:414:30553)`
 * on desktop, `getChoiceByName@plugin:quickadd:414:30553` on iOS.
 *
 * The id is read WITHOUT requiring a trailing `:<line>:<col>`, because an eval'd frame
 * carries the bundle as an origin with no position - `at module.exports (eval at
 * exports.load (plugin:quickadd), <anonymous>:3:47)` is how a user script's own code
 * appears, and `eval at <anonymous> (plugin:dataview)` is how a dataviewjs snippet does.
 * Those are exactly the frames attribution must not skip past. The character class stops
 * at `:` and `)`, so `plugin:quickadd-beta:1:1` still reads as `quickadd-beta` and is not
 * confused with `quickadd`.
 */
const PLUGIN_FRAME = /plugin:([^\s:)]+)/;

/**
 * The frames of a stack, with the `Name: message` header removed.
 *
 * V8 puts the message INSIDE `stack`, so an Error whose message happens to contain
 * `plugin:some-plugin:1:1` could otherwise dictate attribution. Stripping the exact
 * `${name}: ${message}` prefix is engine-agnostic in a way a `/^\s*at /` filter is not:
 * QuickAdd is `isDesktopOnly: false` and Obsidian mobile runs JavaScriptCore, whose
 * frames are `fn@url:line:col` with no `at ` and no header line at all - so filtering on
 * `at ` would silently turn this whole reporter into dead code on iOS and iPadOS.
 */
function stackFrames(error: Error): string[] {
	const stack = error.stack ?? "";
	const header = `${error.name}: ${error.message}`;
	const body = stack.startsWith(header) ? stack.slice(header.length) : stack;
	return body.split("\n");
}

/**
 * The topmost frame that names a plugin bundle: the one closest to where the Error was
 * constructed, and therefore the one that decides whose bug this is. Null when no frame
 * names a plugin at all.
 *
 * `Error.stack` is captured at construction with the whole live call stack, so the old
 * rule - "does ANY frame name us" - claimed other people's bugs: another plugin calling
 * `quickadd.api.suggester(v => v.nope.trim(), items)` builds its TypeError inside its own
 * callback, with QuickAdd frames underneath, and QuickAdd would raise "A QuickAdd action
 * failed" for it AND `preventDefault()` away the console line naming the real culprit
 * (#1602).
 *
 * Measured, so the cost of the stricter rule is known rather than assumed: an Error
 * constructed inside Obsidian's own async plumbing (`vault.create` into a missing folder,
 * awaited from a plugin) carries NO plugin frame at all - not even the caller's - so the
 * old rule was never catching that class either. It stays unclaimed, as before. What the
 * old rule caught and this does not is precisely a foreign frame above ours, which is the
 * false positive. A non-Error rejection (a bare string has no stack) is likewise left
 * alone: with nothing to attribute it to, reporting it would be a guess.
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

/**
 * Dedupe on the throw SITE, not the message.
 *
 * A message often embeds a varying value ("Could not read note <path>"), so keying on it
 * would let one broken loop over 500 notes raise 500 notices. The attributing frame is
 * where the Error was constructed, so the same bug collapses to one report however many
 * values it fails on, while two genuinely different bugs stay distinct. The frame is
 * passed in, not re-derived: nothing reaches this point without one.
 */
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

		// A dismissed prompt is not a failure. It reaches here when a handler floats a
		// prompt (e.g. the macro editor's script picker), and telling the user "an
		// error occurred" because they pressed Escape would be worse than the silence
		// this replaces.
		//
		// Only a USER cancellation is silenced, not every MacroAbortError. Its other
		// subclass, ChoiceAbortError, is how QuickAdd reports involuntary aborts that
		// carry copy the user needs ("Selected folder not allowed.", "…re-run with the
		// ui flag."), and the rest of the plugin keeps the two apart everywhere it
		// matters - choiceExecutor's cancelKind, macroAbortHandler's notice
		// suppression, x-cancel vs x-error. Swallowing those here would leave a floated
		// involuntary abort with LESS signal than the console line it replaces.
		if (isCancellationError(reason)) {
			// Claimed: a dismissal is not something the console should shout about.
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

		// Claim the event only if a notice actually went out. `reportError` now returns
		// false when the same failure was already reported by a layer that also re-threw
		// it (#1601); calling preventDefault first would kill the browser's async trace
		// and put nothing in its place - the opposite of the guarantee the repeat-window
		// branch above keeps.
		if (reportError(error, "A QuickAdd action failed")) {
			event.preventDefault();
		}
	});
}
