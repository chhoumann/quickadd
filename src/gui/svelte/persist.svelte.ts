declare const PLAIN: unique symbol;

/**
 * A value detached from Svelte's reactive `$state` proxy graph via {@link snapshot},
 * making it safe to hand to a persistence sink (zustand `setState`, Obsidian
 * `saveData`, `JSON.stringify`, `structuredClone`, ...).
 *
 * THE RULE (enforced, not by convention):
 *   Never pass a live `$state` proxy to something that persists or serializes it.
 *   Reactive values must cross that boundary through {@link snapshot}, which both
 *   deep-clones AND brands the result `Plain<T>`. Persistence callbacks
 *   (e.g. `saveChoices`, `saveCommands`) accept only `Plain<...>`, so a forgotten
 *   snapshot is a COMPILE error rather than a silent data-loss bug.
 *
 * Why this exists: a `$state` proxy mutation does not write through to the original
 * object, so persisting the un-snapshotted source silently drops in-component edits.
 * That is exactly the conditional Then/Else-branch regression this guard prevents
 * from recurring. `Plain<T>` is assignable to `T`, so plain data flows onward freely;
 * only the inbound direction (raw proxy -> sink) is blocked.
 */
export type Plain<T> = T & { readonly [PLAIN]: true };

/** Deep-clone a (possibly reactive) value into a plain, persistence-safe snapshot. */
export function snapshot<T>(value: T): Plain<T> {
	return $state.snapshot(value) as unknown as Plain<T>;
}
