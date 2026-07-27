import { v4 as uuidv4 } from "uuid";
import type IMultiChoice from "src/types/choices/IMultiChoice";
import type IChoice from "../types/choices/IChoice";
import type { ChoiceType } from "../types/choices/choiceType";

function isMultiChoice(choice: IChoice): choice is IMultiChoice {
	// Null-tolerant: `data.json` can hand us a list with a null/primitive hole in
	// it (see dedupeChoicesById), and every caller below is a total function.
	return isChoiceLike(choice) && choice.type === "Multi";
}

/**
 * Whether `value` is shaped enough like a choice to be walked: a non-null object.
 * `data.json` is untrusted, so a list entry can be `null`, a string, or a number.
 */
export function isChoiceLike(value: unknown): value is IChoice {
	return typeof value === "object" && value !== null;
}

/**
 * The children of a choice, as an array that is always safe to iterate, map or
 * spread. A leaf choice has none; a Multi whose `choices` is missing or is not
 * an array reads as none too.
 *
 * This is the invariant `IMultiChoice.choices` claims but nothing enforces.
 * `data.json` is untrusted input (hand-edited, imported as a package, or frozen
 * mid-write and propagated by Obsidian Sync's whole-file last-write-wins), and
 * `dedupeChoicesById` deliberately preserves a malformed Multi rather than
 * fabricating `[]` for it. So every READER has to be total, and until this
 * helper existed each one guarded (or forgot to) on its own - with two guards
 * that look right and aren't:
 *
 *   `choice.choices ?? []`   passes `{}` straight through (not nullish)
 *   `if (choice.choices)`    passes `{}` straight through (truthy)
 *
 * Only `Array.isArray` rejects both shapes, which is why this is a function and
 * not a convention. Reading through it turned "one malformed folder bricks the
 * plugin" (#1566: onload aborted before choice commands, migrations, startup
 * macros and the CLI ever registered, and the settings tab mounted blank) into
 * "one malformed folder reads as an empty folder".
 *
 * This is a READ view, never a repair: it hands back the live array when there
 * is one and a fresh `[]` otherwise, and nothing persists that `[]`. WRITE paths
 * must leave a malformed `choices` exactly as they found it (guard them with
 * `hasChildChoices`), so the original value survives on disk to be recovered by
 * hand.
 */
export function childChoicesOf(choice: IChoice): IChoice[] {
	if (!isMultiChoice(choice)) return [];
	return Array.isArray(choice.choices) ? choice.choices : [];
}

/**
 * Whether `choice` is a Multi with a real children array, i.e. whether a WRITE
 * path may rebuild it. Guards the `{ ...folder, choices: ... }` rebuilds so a
 * malformed folder is passed through untouched instead of being silently
 * rewritten to the `[]` that `childChoicesOf` reads it as. See #1566.
 */
export function hasChildChoices(choice: IChoice): boolean {
	return isMultiChoice(choice) && Array.isArray(choice.choices);
}

/**
 * A choice list that is always safe to iterate. Same argument as
 * `childChoicesOf`, one level up: the ROOT `settings.choices` is untrusted too,
 * and `loadSettings` deliberately leaves a non-array value in place rather than
 * replacing it with `[]` (which the next save would persist). Use at every read
 * of `settings.choices` / `settingsStore.getState().choices`.
 */
export function rootChoicesOf(value: unknown): IChoice[] {
	return Array.isArray(value) ? value : [];
}

/**
 * Whether a Multi's `choices` holds something we cannot read, as opposed to
 * nothing at all. True only for the malformed shapes that can still CARRY
 * choices: a non-empty object where an array belongs (`{"0": {...}, "1": {...}}`,
 * the classic array-turned-object JSON artefact) or some other non-empty
 * primitive. `undefined`, `null` and `{}` carry nothing, so for those the folder
 * really is empty and the ordinary empty-folder hint is the honest thing to say.
 *
 * This is the line between "degrade quietly" and "tell the user": a folder whose
 * contents we cannot read must not claim to be empty, must offer no affordance
 * that would overwrite the value, and must say so before it is deleted. The
 * hint, the drop target and the delete confirmation all read this one predicate
 * so they cannot disagree.
 */
export function hasUnreadableChildren(choice: IChoice): boolean {
	if (!isMultiChoice(choice)) return false;
	const children: unknown = choice.choices;
	if (children === undefined || children === null) return false;
	if (Array.isArray(children)) return false;
	// A non-array object is only lossy when it actually has keys; anything else
	// non-nullish (a string, a number) was never empty either.
	return typeof children === "object" ? Object.keys(children).length > 0 : true;
}

/**
 * Per-type default icon for choice display and registered commands. Obsidian
 * renders the "question-mark-glyph" ("?") fallback for any command added
 * without an `icon`, which is what QuickAdd commands showed on the mobile
 * editing toolbar (#766). Each choice type maps to a semantically meaningful
 * lucide id.
 *
 * The `default` arm is load-bearing, not decorative: `data.json` is not
 * runtime-validated before commands are registered, and the repo compiles with
 * `strict: false` and no switch-exhaustiveness lint — so an imported or
 * hand-edited choice carrying an unexpected `type` would otherwise fall through
 * to `undefined` and silently re-introduce the "?".
 */
export function defaultIconForChoiceType(type: ChoiceType): string {
	switch (type) {
		case "Template":
			return "file-text";
		case "Capture":
			return "pencil";
		case "Macro":
			return "terminal";
		case "Multi":
			return "folder";
		default:
			return "file-plus";
	}
}

/**
 * Resolve the icon id used when displaying a choice or registering its command.
 * A non-empty per-choice override wins; otherwise the per-type default. Defaults
 * are never written to `data.json`, so the settings payload stays clean and the
 * defaults can evolve freely. `choice.icon` is an optional override (absent for
 * every choice unless explicitly set).
 *
 * The `typeof` guard (not just `?.`) is deliberate: `data.json` is not
 * runtime-validated, so a hand-edited or imported choice could carry a
 * non-string `icon` (e.g. a number or object). Optional chaining alone would
 * let `.trim()` throw and abort command registration / plugin load.
 */
export function resolveChoiceIcon(choice: IChoice): string {
	const override = typeof choice.icon === "string" ? choice.icon.trim() : "";
	return override || defaultIconForChoiceType(choice.type);
}

/**
 * Recursively flattens the choice hierarchy into a single array. Total over a
 * malformed tree: unreadable children read as none, and a list hole (`null`, a
 * primitive) is skipped rather than handed on as if it were a choice.
 */
export function flattenChoices(choices: IChoice[]): IChoice[] {
	const result: IChoice[] = [];

	const walk = (choice: IChoice) => {
		if (!isChoiceLike(choice)) return;
		result.push(choice);
		childChoicesOf(choice).forEach(walk);
	};

	rootChoicesOf(choices).forEach(walk);
	return result;
}

/**
 * Returns the choice tree with every id made globally unique, without losing any
 * data. Walks pre-order; the first occurrence of an id is kept, and a later
 * choice whose id was already seen is either dropped (when byte-identical to the
 * first, so it is a true duplicate) or kept under a fresh id (when its content
 * differs, so a genuinely distinct choice that merely collided survives whole,
 * children and all).
 *
 * Why this exists: the settings tab renders choices in a keyed Svelte
 * `{#each ... (choice.id)}` (ChoiceList.svelte). Svelte 5 throws
 * `each_key_duplicate` on a repeated key, which aborts the settings-tab mount and
 * leaves it blank (#1451) - while the command palette keeps working because
 * commands register by plain recursion (so the symptom reads as "corrupted
 * data"). Choice ids are v4 UUIDs (Choice.ts), so global uniqueness is the real
 * invariant (the command registry is keyed on `choice:<id>` too); a repeat only
 * comes from external corruption - e.g. Obsidian Sync freezing a transient
 * duplicate and propagating it via whole-file last-write-wins (no JSON/array
 * merge) - never from a legitimately distinct choice.
 *
 * Called once where data enters the app (loadSettings): the cleaned tree renders
 * and registers commands correctly, and the next ordinary settings save rewrites
 * data.json cleaned. Pure - never mutates its input.
 */
export function dedupeChoicesById(choices: IChoice[]): IChoice[] {
	// id -> first kept choice with that id (the original object, for comparison).
	const firstById = new Map<string, IChoice>();

	const walk = (list: IChoice[]): IChoice[] => {
		const out: IChoice[] = [];
		for (const choice of list) {
			// A list entry can be `null` or a primitive (a truncated write, a bad
			// hand-edit). Keep it verbatim - preserving is this function's whole
			// point - but never dereference it: this runs inside loadSettings, ~200
			// lines before addSettingTab, so a throw here costs the settings tab
			// itself and every command with it.
			if (!isChoiceLike(choice)) {
				out.push(choice);
				continue;
			}
			let current = choice;
			const prior = firstById.get(current.id);
			if (prior) {
				// Compare the whole choice (incl. nested children) to the first
				// occurrence: equal => true duplicate, drop it; otherwise a real id
				// collision, so keep it under a fresh id (nothing lost).
				if (JSON.stringify(current) === JSON.stringify(prior)) {
					continue;
				}
				current = { ...current, id: uuidv4() };
			}
			firstById.set(current.id, current);
			// Recurse only into a real children array; a malformed Multi (missing or
			// non-array children) is kept exactly as-is, never given a fabricated [].
			if (isMultiChoice(current) && Array.isArray(current.choices)) {
				const repaired: IMultiChoice = {
					...current,
					choices: walk(current.choices),
				};
				current = repaired;
			}
			out.push(current);
		}
		return out;
	};

	return walk(choices);
}

export interface FlatChoicePathEntry {
	choice: IChoice;
	id: string;
	/** Name path from the root to this choice, including the choice's own name. */
	path: string[];
	depth: number;
	parentId: string | null;
}

/**
 * Recursively flattens the choice hierarchy in pre-order, tracking each
 * choice's name path through its ancestor Multi choices.
 */
export function flattenChoicesWithPath(
	choices: IChoice[],
	parentPath: string[] = [],
	depth = 0,
	parentId: string | null = null,
): FlatChoicePathEntry[] {
	const result: FlatChoicePathEntry[] = [];
	for (const choice of rootChoicesOf(choices)) {
		if (!isChoiceLike(choice)) continue;
		const path = [...parentPath, choice.name];
		result.push({ choice, id: choice.id, path, depth, parentId });
		result.push(
			...flattenChoicesWithPath(
				childChoicesOf(choice),
				path,
				depth + 1,
				choice.id,
			),
		);
	}
	return result;
}
