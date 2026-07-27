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
 * Dedupe on the throw SITE, not the message.
 *
 * A message often embeds a varying value ("Could not read note <path>"), so keying on it
 * would let one broken loop over 500 notes raise 500 notices. The first `plugin:<id>`
 * frame is where the Error was constructed, so the same bug collapses to one report
 * however many values it fails on, while two genuinely different bugs stay distinct.
 */
function dedupeKey(error: Error, pluginId: string): string {
	const frame = (error.stack ?? "")
		.split("\n")
		.find((line) => line.includes(`plugin:${pluginId}`));
	return `${error.name}@${frame?.trim() ?? error.message}`;
}

/**
 * True only when the rejection demonstrably came from QuickAdd's own bundle.
 *
 * Obsidian evaluates a plugin's `main.js` with a `sourceURL` of `plugin:<id>`, so any
 * Error constructed inside QuickAdd carries frames like
 * `at mS.getChoiceByName (plugin:quickadd:414:30553)`. Requiring that keeps QuickAdd from
 * claiming another plugin's bug, and is why a non-Error rejection (a bare string has no
 * stack) is left alone: with nothing to attribute it to, reporting it would be a guess.
 */
function isFromPlugin(reason: unknown, pluginId: string): boolean {
	return (
		reason instanceof Error &&
		typeof reason.stack === "string" &&
		reason.stack.includes(`plugin:${pluginId}`)
	);
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
	const recentlyReported = new Map<string, number>();

	plugin.registerDomEvent(window, "unhandledrejection", (event) => {
		const reason = event.reason;
		if (!isFromPlugin(reason, pluginId)) return;

		// Ours, so stop the console noise either way.
		event.preventDefault();

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
		if (isCancellationError(reason)) return;

		const error = reason as Error;
		const key = dedupeKey(error, pluginId);
		const at = now();
		const last = recentlyReported.get(key);
		if (last !== undefined && at - last < REPEAT_WINDOW_MS) return;

		if (recentlyReported.size >= MAX_TRACKED) {
			for (const [tracked, seenAt] of recentlyReported) {
				if (at - seenAt >= REPEAT_WINDOW_MS) recentlyReported.delete(tracked);
			}
			// Still full: every entry is fresh, so drop the oldest to make room.
			if (recentlyReported.size >= MAX_TRACKED) {
				const oldest = recentlyReported.keys().next();
				if (!oldest.done) recentlyReported.delete(oldest.value);
			}
		}
		recentlyReported.set(key, at);

		reportError(error, "A QuickAdd action failed");
	});
}
