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
 * Where a macro's command list actually lives, given an untrusted `macro`.
 *
 * Normally `macro.commands`. But an ARRAY-valued `macro` is treated as the
 * command list itself: writing `macro.commands` onto an Array is dropped by
 * `JSON.stringify`, so the recoverable reading is that the array IS the
 * commands (someone saved `macro: commands`). Every consumer has to agree on
 * that, or the macro builder repairs one list while the package importer
 * remaps another - hence one function rather than a convention.
 *
 * Returns `undefined` for a value that carries nothing, so the caller can tell
 * "no commands" from "commands we could not read" via
 * {@link isUnreadableCommandList} on the result.
 */
export function macroCommandsValueOf(macro: unknown): unknown {
	if (isMacroObject(macro)) return macro.commands;
	return isUnreadableMacro(macro) ? macro : undefined;
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
 * The pre-consolidation `settings.macros` array, as something always safe to
 * iterate. The sibling of `rootChoicesOf` for the other legacy root container:
 * it is as untrusted as the rest of `data.json`, and three migrations used to
 * reach it through `settings.macros ?? []`, which passes `{"0": {...}}` straight
 * through (not nullish) and then throws `macros is not iterable` - aborting the
 * migration, reverting it, and firing a 15-second "please create an issue"
 * notice on every single launch.
 *
 * READ view only. A WRITE back to `settings.macros` must stay guarded by
 * `Array.isArray`, or it persists this `[]` over the value the user needs to
 * recover by hand.
 */
export function rootMacrosOf<T = IMacro>(value: unknown): T[] {
	return Array.isArray(value) ? (value as T[]) : [];
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
		// An ARRAY entry is read as a NESTED LIST and spliced in, the same
		// recoverable reading `macroCommandsValueOf` gives an array-valued `macro`.
		// `isCommandLike([])` is true, so the alternative is spreading it into one
		// nameless, typeless row. Kept byte-symmetric with `normalizeChoiceList`.
		if (Array.isArray(entry)) {
			const inner = normalizeCommandList(entry);
			for (const command of inner.commands) {
				const id = command.id;
				if (typeof id === "string" && id !== "" && !seen.has(id)) {
					seen.add(id);
					commands.push(command);
					continue;
				}
				const replacement = { ...command, id: uuidv4() };
				seen.add(replacement.id);
				commands.push(replacement);
			}
			changed = true;
			continue;
		}
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
 * Recurses the whole macro, not just its top level. Re-iding only the outermost
 * commands left every id BELOW that identical between the original and the copy -
 * a Conditional's `thenCommands`/`elseCommands`, a NestedChoice's inner choice,
 * and that choice's own macro if it had one (#1609). Nothing crashed, because it
 * is not a within-list collision, but:
 *
 *   - `buildUserScriptSecretId` keys a stored user-script secret on
 *     `command.id`, so a duplicated macro's NESTED UserScript command re-adopted
 *     the ORIGINAL's secret slot. Setting the API key on the copy set it on the
 *     original.
 *   - the nested `IChoice` kept its id too, colliding with the original's in
 *     every by-id walk over commands (packageTraversal, collectChoiceClosure).
 *
 * Total over a malformed macro, because `duplicateChoice` runs over whatever
 * data.json holds: the command list is resolved through `macroCommandsValueOf`
 * (so an ARRAY-valued macro is re-ided as the command list it is, rather than
 * having a non-index `id` written onto it that JSON.stringify would drop), a
 * non-array list is left exactly as found (this is a WRITE path - see
 * `hasCommandList`), and a hole is stepped over rather than dereferenced.
 *
 * `visited` is about SHARED references, not cycles: `deepClone` is
 * `structuredClone`, which preserves both. Two pointers to one command are one
 * command, so it is re-ided once rather than twice. (A true cycle cannot come
 * out of `data.json` - JSON has no way to express one - and the secret sanitizer
 * `duplicateChoice` runs afterwards would recurse forever on one regardless, so
 * this does not claim to make that survivable.)
 */
export function regenerateIds(macro: IMacro): void {
	regenerateMacroIds(macro, new Set<unknown>());
}

function regenerateMacroIds(macro: unknown, visited: Set<unknown>): void {
	if (!isCommandLike(macro)) return;
	if (visited.has(macro)) return;
	visited.add(macro);
	// Only a real macro OBJECT has an `id` worth minting. Writing one onto an
	// array-valued macro is a no-op JSON.stringify discards, not a repair.
	if (isMacroObject(macro)) macro.id = uuidv4();
	regenerateCommandIds(macroCommandsValueOf(macro), visited);
}

function regenerateCommandIds(commands: unknown, visited: Set<unknown>): void {
	if (!hasCommandList(commands)) return;
	for (const command of commands as ICommand[]) {
		// A nested ARRAY is a command list (`normalizeCommandList` splices one in),
		// so recurse rather than writing an `id` onto it that JSON.stringify drops -
		// which would leave every id inside it shared with the original.
		if (Array.isArray(command)) {
			regenerateCommandIds(command, visited);
			continue;
		}
		if (!isCommandLike(command)) continue;
		if (visited.has(command)) continue;
		visited.add(command);

		command.id = uuidv4();

		const branching = command as unknown as {
			thenCommands?: unknown;
			elseCommands?: unknown;
			choice?: unknown;
		};
		regenerateCommandIds(branching.thenCommands, visited);
		regenerateCommandIds(branching.elseCommands, visited);
		regenerateChoiceIds(branching.choice, visited);
	}
}

function regenerateChoiceIds(choice: unknown, visited: Set<unknown>): void {
	if (!isCommandLike(choice)) return;
	if (visited.has(choice)) return;
	visited.add(choice);

	const node = choice as { id?: unknown; type?: unknown; macro?: unknown; choices?: unknown };
	node.id = uuidv4();

	if (node.type === "Macro") regenerateMacroIds(node.macro, visited);
	if (node.type === "Multi" && Array.isArray(node.choices)) {
		for (const child of node.choices) regenerateChoiceIds(child, visited);
	}
}
