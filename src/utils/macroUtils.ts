import { v4 as uuidv4 } from "uuid";
import type { IMacro } from "../types/macros/IMacro";
import type { ICommand } from "../types/macros/ICommand";

/**
 * Whether `value` is shaped enough like a command to be walked: a non-null
 * object. `data.json` is untrusted, so a command list can hold a `null` (a
 * truncated write), a string, or a number.
 *
 * The sibling of `isChoiceLike` in choiceUtils.ts, and the same argument applies.
 */
export function isCommandLike(value: unknown): value is ICommand {
	return typeof value === "object" && value !== null;
}

/**
 * Whether `value` is a macro OBJECT we can read and write through.
 *
 * `isCommandLike` is not enough here, because `typeof [] === "object"`: an
 * array-valued `macro` would pass it, and `macro.commands = [...]` on an Array
 * writes a non-index property that `JSON.stringify` (i.e. `saveData`) and
 * `$state.snapshot` both discard - so the user's edits would vanish on every
 * save while the editor showed them happily.
 */
export function isMacroObject(
	value: unknown,
): value is Record<string, unknown> {
	return isCommandLike(value) && !Array.isArray(value);
}

/**
 * Whether a `macro` value is something we cannot read that could still be
 * carrying a macro. Same "degrade quietly vs tell the user" line as
 * {@link isUnreadableCommandList}, one level up: an empty array carries nothing
 * (so the editor may replace it), a non-empty one might.
 */
export function isUnreadableMacro(value: unknown): boolean {
	if (isMacroObject(value)) return false;
	if (Array.isArray(value)) return value.length > 0;
	return isUnreadableCommandList(value);
}

/**
 * A command list that is always safe to iterate, map or spread.
 *
 * `IMacro.commands` is declared `ICommand[]` and nothing enforces it. This is
 * the same untrusted-input problem `childChoicesOf` solves one type over, with
 * the same two guards that look right and are not:
 *
 *   `macro.commands ?? []`    passes `{}` straight through (not nullish)
 *   `if (macro.commands)`     passes `{}` AND `"not a list"` through (truthy)
 *
 * Both shapes are real: `{"0": {...}, "1": {...}}` is the classic
 * array-turned-object JSON artefact, and a string reaches `for..of` intact
 * because strings are iterable - which is how a malformed macro used to "run"
 * successfully while doing nothing at all (#1593).
 *
 * Takes `unknown` rather than `IMacro` on purpose (mirroring `rootChoicesOf`):
 * `choice.macro` is untrusted too, so the callers that need this most cannot
 * produce an `IMacro` to pass. Read `commandListOf(choice.macro?.commands)`.
 *
 * This is a READ view, never a repair: nothing here persists the `[]` it hands
 * back for a malformed value. WRITE paths must leave a malformed `commands`
 * exactly as they found it - guard them with `hasCommandList` - so the original
 * survives on disk to be recovered by hand.
 */
export function commandListOf(value: unknown): ICommand[] {
	return Array.isArray(value) ? value : [];
}

/**
 * Whether `value` is a real command array, i.e. whether a WRITE path may rebuild
 * it. Guards the `{ ...macro, commands: ... }` rebuilds so a malformed list is
 * passed through untouched instead of being silently rewritten to the `[]` that
 * `commandListOf` reads it as.
 */
export function hasCommandList(value: unknown): boolean {
	return Array.isArray(value);
}

/**
 * Whether a command list value holds something we cannot read, as opposed to
 * nothing at all. True only for the malformed shapes that can still CARRY
 * commands: a non-empty object where an array belongs, or a non-empty primitive
 * (a double-encoded `"[{\"id\":...}]"` is a routine scripted-edit artefact, and
 * in general we cannot prove that an unreadable non-empty value is empty).
 *
 * `undefined`, `null`, `{}`, `""`, `0` and `false` carry nothing, so for those
 * the macro really has no commands and an empty editor is the honest thing to
 * show.
 *
 * This is the line between "degrade quietly" and "tell the user": a macro whose
 * commands we cannot read must not claim to be empty, and must offer no
 * affordance that would overwrite the value. The editor's card and its
 * suppressed controls both read this one predicate so they cannot disagree.
 */
export function isUnreadableCommandList(value: unknown): boolean {
	if (Array.isArray(value)) return false;
	if (value === undefined || value === null) return false;
	if (typeof value === "object") return Object.keys(value).length > 0;
	// A non-empty primitive was never empty; an empty one carries nothing.
	return Boolean(value);
}

export interface NormalizedCommandList {
	commands: ICommand[];
	/** False when `commands` is the input array itself, unchanged. */
	changed: boolean;
}

/**
 * The command list an EDITOR should work over: every entry an object with an id
 * that is unique within the list.
 *
 * Two things go wrong in a list that is otherwise a perfectly good array, and
 * both used to cost the user the whole macro editor (#1593). Svelte's keyed
 * `{#each ... (command.id)}` throws `each_key_duplicate` on a repeated key and
 * `Cannot read properties of null` on a hole, and svelte-dnd-action reads `.id`
 * on every item it is handed. Either throw aborts the mount, which since #1584
 * means an honest error card - and a macro that can only be repaired by hand.
 *
 * The two cases are NOT the same and are deliberately not treated the same:
 *
 *   - A duplicate or missing id is a REAL command that merely cannot be keyed.
 *     It is given a fresh uuid and kept. Never dropped: dropping it would hide a
 *     working command from the one screen that could delete it, and the editor
 *     persists the list it rendered, so the next reorder would erase it from
 *     disk with no prompt and no undo.
 *   - A `null` or a stray primitive carries nothing: there is no command to
 *     re-id, the engine already steps over it, and it is dropped.
 *
 * Re-iding is safe for stored user-script secrets: a secret lives in the
 * command's own `settings` as a `{secretRef}` object and travels with it
 * (userScriptSecrets.ts). Only the stable-id RE-ADOPTION path
 * (`buildUserScriptSecretId`) keys on `command.id`, and it only runs for a
 * setting that has no ref yet.
 *
 * Applied once at the editor seam (CommandSequenceEditor's constructor), never
 * at load: `loadSettings` runs before the migrations and never saves, so a heal
 * there would mint fresh uuids on every launch until an unrelated save landed.
 * Here it is idempotent per session and is persisted by the user's first
 * ordinary edit.
 *
 * Returns the input array itself when there was nothing to change, so a healthy
 * macro is provably untouched.
 */
export function normalizeCommandList(value: unknown): NormalizedCommandList {
	const input = commandListOf(value);
	const seen = new Set<string>();
	let changed = false;

	const commands: ICommand[] = [];
	for (const entry of input) {
		if (!isCommandLike(entry)) {
			changed = true;
			continue;
		}
		const id = entry.id;
		if (typeof id === "string" && id !== "" && !seen.has(id)) {
			seen.add(id);
			commands.push(entry);
			continue;
		}
		const replacement = { ...entry, id: uuidv4() };
		seen.add(replacement.id);
		commands.push(replacement);
		changed = true;
	}

	return changed ? { commands, changed } : { commands: input, changed: false };
}

/**
 * Regenerates all IDs in a macro to prevent collisions after duplication.
 *
 * Total over a malformed macro: a missing or non-array `commands` is left
 * exactly as it is (this is a WRITE path - see `hasCommandList`), and a hole in
 * the list is stepped over rather than dereferenced. Reached from
 * `duplicateChoice`, which runs over whatever the user's data.json holds.
 */
export function regenerateIds(macro: IMacro): void {
	if (!isCommandLike(macro)) return;
	macro.id = uuidv4();
	if (!hasCommandList(macro.commands)) return;
	macro.commands.forEach((command) => {
		if (!isCommandLike(command)) return;
		command.id = uuidv4();
	});
}
