import { isUnreadableList as isUnreadableChoiceList } from "./persistedContainers";
import { uuidv4 } from "./uuid";
import type IMultiChoice from "src/types/choices/IMultiChoice";
import type IChoice from "../types/choices/IChoice";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import type { ChoiceType } from "../types/choices/choiceType";
import { isMultiChoice } from "../types/choices/choiceGuards";

/**
 * Whether `value` is shaped enough like a choice to be walked: a non-null,
 * non-array object. `data.json` is untrusted, so a list entry can be `null`, a
 * string, a number, or an array.
 */
export function isChoiceLike(value: unknown): value is IChoice {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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
 * skipped subtree after the user repairs it. Migrations using walkChoicesInSettings
 * must instead use settingsTreeHasUnreadableData, which also checks commands.
 * The root must be an array; empty values below it contain nothing to migrate.
 */
export function treeHasUnreadableChildren(choices: unknown): boolean {
	if (!Array.isArray(choices)) return true;
	const walk = (list: IChoice[]): boolean =>
		list.some((choice) => {
			// A nested array can carry choices (the editor seam splices one in)
			// that flattenChoices would not descend, so a migration would
			// misclassify them. Stay pending until the seam repairs it.
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
 * A non-empty per-choice override wins, else the per-type default; defaults are
 * never written to data.json. The `typeof` guard matters: data.json is not
 * validated, and a non-string `icon` would make `.trim()` abort command
 * registration.
 */
export function resolveChoiceIcon(choice: IChoice): string {
	const override = typeof choice.icon === "string" ? choice.icon.trim() : "";
	return override || defaultIconForChoiceType(choice.type);
}

/**
 * Recursively flattens the choice hierarchy into a single array. Total over a
 * malformed tree: unreadable children read as none, and a list hole (`null`, a
 * primitive, an array) is skipped rather than handed on as if it were a choice.
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
 * Returns the choice tree with every id globally unique, losing no data. The
 * first occurrence keeps its id; a later byte-identical duplicate is dropped and
 * a differing one gets a fresh id. Svelte's keyed each throws on a repeated key,
 * which blanks the settings tab. Repeats only come from external corruption,
 * such as Obsidian Sync's whole-file last-write-wins. Pure.
 */
export function dedupeChoicesById(choices: IChoice[]): IChoice[] {
	const firstById = new Map<string, IChoice>();

	const walk = (list: IChoice[]): IChoice[] => {
		const out: IChoice[] = [];
		for (const choice of list) {
			// Keep a `null` or primitive entry verbatim but never dereference it: a
			// throw here, inside loadSettings, costs the settings tab and every command.
			if (!isChoiceLike(choice)) {
				out.push(choice);
				continue;
			}
			let current = choice;
			const prior = firstById.get(current.id);
			if (prior) {
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

/**
 * An empty Capture format or File name means the default. QuickAdd 2.29 and
 * earlier saved `enabled: true` with no text, which the run read as "write
 * nothing"; clearing the flag makes the run agree with the builder. The text is
 * kept.
 */
export function clearEmptyFormatFlag(choice: IChoice): void {
	const field: unknown =
		choice.type === "Capture" ? (choice as ICaptureChoice).format :
		choice.type === "Template" ? (choice as ITemplateChoice).fileNameFormat :
		undefined;
	if (!field || typeof field !== "object") return;
	const format = field as { enabled?: unknown; format?: unknown };
	const text = typeof format.format === "string" ? format.format : "";
	if (format.enabled === true && text.trim() === "") format.enabled = false;
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

/**
 * The first choice whose `name` or `id` is `value`, in the pre-order the
 * settings list shows, with its path. Names are not unique, so a name means
 * the first match.
 */
export function findChoiceWithPath(
	choices: IChoice[],
	by: "name" | "id",
	value: string,
): FlatChoicePathEntry | undefined {
	return flattenChoicesWithPath(choices).find((entry) => entry.choice[by] === value);
}
