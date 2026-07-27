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
 * Whether ANY node in the tree has children we cannot read.
 *
 * The distinction matters to migrations. A reader can walk past an unreadable
 * folder and be correct; a migration that MOVES data (or deletes the source it
 * moved from) cannot, because it is flagged complete and never retried - so the
 * subtree it silently skipped stays un-migrated forever, even after the user
 * repairs data.json by hand. Such a migration must stay pending instead, and
 * this is the question it has to ask about the WHOLE tree, not just the root.
 *
 * This is the narrow, FOLDERS-ONLY question, for the migrations that recurse
 * `Multi.choices` themselves (removeMacroIndirection via `flattenChoices`,
 * incrementFileName..., mutualExclusion...). A migration that walks with
 * `walkAllChoices` reaches macro commands too and must ask the wider
 * `settingsTreeHasUnreadableData` instead. Matching the guard to the traversal
 * is deliberate: blocking `removeMacroIndirection` on an unreadable
 * `macro.commands` it was never going to descend would strand every legacy macro
 * choice in the vault (nothing at runtime resolves `macroId`) in exchange for
 * nothing at all.
 *
 * The root is judged strictly and everything below it by
 * {@link isUnreadableChoiceList} - see the same asymmetry, and why, in
 * `walkSettings`. A folder with no `choices` key carries nothing, and treating
 * it as unreadable (as this did until #1610) kept `removeMacroIndirection`
 * pending forever over a folder that was merely empty.
 *
 * See #1566, and `MigrationResult` in src/migrations/Migrations.ts.
 */
export function treeHasUnreadableChildren(choices: unknown): boolean {
	if (!Array.isArray(choices)) return true;
	const walk = (list: IChoice[]): boolean =>
		list.some((choice) => {
			// A nested ARRAY can be carrying choices - the editor seam splices one
			// into the tree - and `flattenChoices` pushes it as if it were a choice
			// rather than descending it. So removeMacroIndirection would classify a
			// macro referenced from inside one as orphaned, duplicate it at the root
			// and delete `settings.macros`. Stay pending until the seam has repaired
			// it (#1608/#1610).
			if (Array.isArray(choice)) return true;
			if (!isChoiceLike(choice)) return false;
			if (choice.type !== "Multi") return false;
			const children: unknown = (choice as IMultiChoice).choices;
			if (!Array.isArray(children)) return isUnreadableChoiceList(children);
			return walk(children);
		});
	return walk(choices);
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
 * Whether a `choices` VALUE holds something we cannot read, as opposed to
 * nothing at all. True only for the malformed shapes that can still CARRY
 * choices: a non-empty object where an array belongs (`{"0": {...}, "1": {...}}`,
 * the classic array-turned-object JSON artefact) or a non-empty primitive.
 * `undefined`, `null`, `{}`, `""`, `0` and `false` carry nothing, so for those
 * the folder really is empty and the ordinary empty-folder hint is honest.
 *
 * The sibling of `isUnreadableCommandList` in macroUtils.ts, deliberately kept
 * as a sibling rather than a shared module (the same shape as
 * `isChoiceLike`/`isCommandLike` and `rootChoicesOf`/`rootMacrosOf`). The
 * two must answer identically for every value; `unreadableValuePredicates.test.ts`
 * is the ratchet that says so, over the union of both shape lists.
 *
 * This is the line between "degrade quietly" and "tell the user": a container
 * whose contents we cannot read must not claim to be empty, must offer no
 * affordance that would overwrite the value, and must say so before it is
 * deleted. The hint, the drop target and the delete confirmation all read this
 * one predicate so they cannot disagree.
 */
export function isUnreadableChoiceList(value: unknown): boolean {
	if (Array.isArray(value)) return false;
	if (value === undefined || value === null) return false;
	if (typeof value === "object") return Object.keys(value).length > 0;
	// A non-empty primitive was never empty; an empty one carries nothing. The
	// `""`/`0`/`false` arm is #1611: this function documented that rule from the
	// start and its `: true` arm contradicted it, so a folder whose `choices` was
	// `""` got the "couldn't read this" notice, lost its drop target, and got the
	// scarier delete confirmation - for a value carrying nothing at all.
	return Boolean(value);
}

/** {@link isUnreadableChoiceList}, asked about a Multi node rather than a value. */
export function hasUnreadableChildren(choice: IChoice): boolean {
	if (!isMultiChoice(choice)) return false;
	return isUnreadableChoiceList(choice.choices);
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

export interface RepairedChoiceId {
	/** The id the choice had, exactly as `data.json` held it. */
	previousId: unknown;
	/** The choice as it is now, under an id that can be keyed. */
	choice: IChoice;
}

export interface NormalizedChoiceList {
	choices: IChoice[];
	/** False when `choices` is the input array itself, unchanged. */
	changed: boolean;
	repaired: RepairedChoiceId[];
}

/**
 * The choice tree an EDITOR should work over: every entry an object with an id
 * that is unique across the whole tree.
 *
 * The sibling of `normalizeCommandList` (macroUtils.ts) and the same argument,
 * on the list one level up. `ChoiceList` renders a keyed `{#each ... (choice.id)}`
 * and seeds svelte-dnd-action from the same array, so an entry with no usable id
 * cannot be rendered - and the list it filtered for rendering is the list its
 * persist path writes back. So the filter was not a "render-time view only" after
 * all: the first drag or ArrowDown wrote the filtered array to disk, and
 *
 *     { "name": "Daily note", "type": "Template", "templatePath": "...", "id": 12 }
 *
 * - a complete, working, runnable choice whose id was written as a JSON number by
 * a hand-edit, a script or a merge - was deleted with no prompt and no undo, from
 * a row the user could never see in the first place (#1608).
 *
 * The two cases are NOT the same and are deliberately not treated the same:
 *
 *   - An entry that cannot be KEYED (id missing, empty, not a string, or already
 *     used elsewhere in the tree) is a real choice. It is given a fresh uuid and
 *     kept, so it becomes visible, editable and deletable for the first time.
 *   - A `null` or a stray primitive carries nothing. There is nothing to re-key,
 *     every walker already steps over one, and it is dropped.
 *   - An ARRAY entry is read as a NESTED LIST and its members are spliced in -
 *     the same recoverable reading `macroCommandsValueOf` gives an array-valued
 *     `macro`. `isChoiceLike([])` is true, so the alternative is spreading it
 *     into one nameless, typeless row whose delete dialog says `delete
 *     'undefined'`.
 *
 * A repaired id is always a fresh uuid, never a coercion of the old value.
 * `String(12)` looks tempting - it would keep the registered `quickadd:choice:12`
 * alive - but ids are compared with `===` in `getChoice`, so a `12` -> `"12"`
 * rewrite silently breaks a `ChoiceCommand{choiceId: 12}` (MacroChoiceEngine
 * matches /not found/i and skips the step), and "that string is free" can only
 * mean "not seen YET" during a pre-order walk, so it can also steal a healthy
 * later sibling's id. A stored reference to a malformed id does break here - but
 * the behaviour it replaces DELETED the choice on the first reorder, which broke
 * the same reference and lost the choice with it.
 *
 * Recurses only through `hasChildChoices`, so a folder whose `choices` value
 * could not be read is passed through exactly as found - never replaced with the
 * `[]` that `childChoicesOf` reads it as.
 *
 * Returns the input array itself when there was nothing to change, so a healthy
 * tree is provably untouched, and takes `unknown` because `settings.choices` is.
 * A non-array root reads as `[]` here; the CALLER must refuse to render (and
 * therefore to save) rather than pass it in - see ChoiceView's `rootUnreadable`.
 */
export function normalizeChoiceList(value: unknown): NormalizedChoiceList {
	if (!Array.isArray(value)) return { choices: [], changed: false, repaired: [] };

	const seen = new Set<string>();
	const repaired: RepairedChoiceId[] = [];

	const walk = (list: unknown[]): IChoice[] => {
		let changed = false;
		const out: IChoice[] = [];

		for (const entry of list) {
			if (Array.isArray(entry)) {
				changed = true;
				out.push(...walk(entry));
				continue;
			}
			if (!isChoiceLike(entry)) {
				changed = true;
				continue;
			}

			let node: IChoice = entry;
			if (hasChildChoices(node)) {
				// `hasChildChoices` already proved this is a real array.
				const children = (node as IMultiChoice).choices as IChoice[];
				const next = walk(children);
				if (next !== children) {
					node = { ...(node as IMultiChoice), choices: next } as IChoice;
					changed = true;
				}
			}

			const id: unknown = node.id;
			if (typeof id === "string" && id !== "" && !seen.has(id)) {
				seen.add(id);
				out.push(node);
				continue;
			}

			const replacement = { ...node, id: uuidv4() } as IChoice;
			seen.add(replacement.id);
			repaired.push({ previousId: id, choice: replacement });
			out.push(replacement);
			changed = true;
		}

		return changed ? out : (list as IChoice[]);
	};

	const choices = walk(value);
	return { choices, changed: choices !== value, repaired };
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
