import { v4 as uuidv4 } from "uuid";
import type IMultiChoice from "src/types/choices/IMultiChoice";
import type IChoice from "../types/choices/IChoice";
import type { ChoiceType } from "../types/choices/choiceType";

function isMultiChoice(choice: IChoice): choice is IMultiChoice {
	return choice.type === "Multi";
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
 * Recursively flattens the choice hierarchy into a single array.
 */
export function flattenChoices(choices: IChoice[]): IChoice[] {
	const result: IChoice[] = [];

	const walk = (choice: IChoice) => {
		result.push(choice);
		if (isMultiChoice(choice) && choice.choices) {
			choice.choices.forEach(walk);
		}
	};

	choices.forEach(walk);
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
	for (const choice of choices) {
		const path = [...parentPath, choice.name];
		result.push({ choice, id: choice.id, path, depth, parentId });
		if (isMultiChoice(choice)) {
			result.push(
				...flattenChoicesWithPath(
					choice.choices ?? [],
					path,
					depth + 1,
					choice.id,
				),
			);
		}
	}
	return result;
}
