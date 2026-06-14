import type IMultiChoice from "src/types/choices/IMultiChoice";
import type IChoice from "../types/choices/IChoice";
import type { CaptureChoice } from "../types/choices/CaptureChoice";
import type { ChoiceType } from "../types/choices/choiceType";
import type { MacroChoice } from "../types/choices/MacroChoice";
import type { MultiChoice } from "../types/choices/MultiChoice";
import type { TemplateChoice } from "../types/choices/TemplateChoice";

function isMultiChoice(choice: IChoice): choice is IMultiChoice {
	return choice.type === "Multi";
}

export function getChoiceType<
	T extends TemplateChoice | MultiChoice | CaptureChoice | MacroChoice,
>(choice: IChoice): choice is T {
	const isTemplate = (choice: IChoice): choice is TemplateChoice =>
		choice.type === "Template";
	const isMacro = (choice: IChoice): choice is MacroChoice =>
		choice.type === "Macro";
	const isCapture = (choice: IChoice): choice is CaptureChoice =>
		choice.type === "Capture";
	const isMulti = (choice: IChoice): choice is MultiChoice =>
		choice.type === "Multi";

	return (
		isTemplate(choice) ||
		isMacro(choice) ||
		isCapture(choice) ||
		isMulti(choice)
	);
}

/**
 * Per-type default icon for a choice's registered command. Obsidian renders the
 * "question-mark-glyph" ("?") fallback for any command added without an `icon`,
 * which is what QuickAdd commands showed on the mobile editing toolbar (#766).
 * Each choice type maps to a semantically meaningful lucide id.
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
 * Resolve the icon id used when registering a choice's command. A non-empty
 * per-choice override wins; otherwise the per-type default. Resolved at
 * registration time only — defaults are never written to `data.json`, so the
 * settings payload stays clean and the defaults can evolve freely. `choice.icon`
 * is an optional override (absent for every choice unless explicitly set).
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
