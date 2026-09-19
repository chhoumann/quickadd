import { isUnreadableList as isUnreadableChoiceList } from "./persistedContainers";
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
 * A read-only view: missing or malformed children read as empty. Never persist this
 * fallback over unreadable data; write paths must first check hasChildChoices.
 */
export function childChoicesOf(choice: IChoice): IChoice[] {
	if (!isMultiChoice(choice)) return [];
	return Array.isArray(choice.choices) ? choice.choices : [];
}

/**
 * Whether a Multi has a real child array that write paths may rebuild.
 */
export function hasChildChoices(choice: IChoice): boolean {
	return isMultiChoice(choice) && Array.isArray(choice.choices);
}

/**
 * Whether a folder-only traversal would skip recoverable data. Migrations that
 * move data must stay pending when this is true; completing them strands the
 * skipped subtree after the user repairs it. Migrations using walkAllChoices
 * must instead use settingsTreeHasUnreadableData, which also checks commands.
 * The root must be an array; empty values below it contain nothing to migrate.
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
 * Read view of the untrusted root. Never persist its empty fallback over a
 * malformed settings.choices value.
 */
export function rootChoicesOf(value: unknown): IChoice[] {
	return Array.isArray(value) ? value : [];
}

/**
 * True for non-array containers that may carry recoverable data. Empty values
 * (undefined, null, {}, "", 0, false) carry nothing. Readers, editor affordances,
 * and deletion warnings must share this predicate to avoid overwriting data.
 */
export { isUnreadableList as isUnreadableChoiceList } from "./persistedContainers";

/** {@link isUnreadableChoiceList}, asked about a Multi node rather than a value. */
export function hasUnreadableChildren(choice: IChoice): boolean {
	if (!isMultiChoice(choice)) return false;
	return isUnreadableChoiceList(choice.choices);
}

/**
 * Default icons are display-only. Unknown persisted types retain a usable icon.
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
 * Normalize at the editor seam, preserving real choices and malformed child
 * containers. Flatten nested arrays, drop primitives, and mint fresh UUIDs for
 * missing or duplicate IDs across the tree. Never coerce IDs: that could steal a
 * later sibling's ID or change reference matching. Return the original array
 * when unchanged. Callers must refuse to save a malformed root.
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

			const replacement = { ...node, id: uuidv4() };
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
