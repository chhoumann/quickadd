import type { ChoiceType } from "../types/choices/choiceType";
import { CaptureChoice } from "../types/choices/CaptureChoice";
import type IChoice from "../types/choices/IChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import { MacroChoice } from "../types/choices/MacroChoice";
import { MultiChoice } from "../types/choices/MultiChoice";
import { TemplateChoice } from "../types/choices/TemplateChoice";
import { macroCommandsValueOf, regenerateIds } from "../utils/macroUtils";
import {
	childChoicesOf,
	hasChildChoices,
	hasUnreadableChildren,
	isChoiceLike,
} from "../utils/choiceUtils";
import { excludeKeys } from "../utils/excludeKeys";
import { deepClone } from "../utils/deepClone";
import { isRecord } from "../utils/isRecord";
import {
	stripUserScriptSecretRefsFromChoice,
	type UserScriptSecretSanitizerOptions,
} from "../utils/userScriptSecrets";

// Pure, immutable operations on the choice tree. Nothing here opens a page,
// asks the user or touches the vault; the settings list composes these with
// its prompts in gui/choiceList/choiceUiService.ts.

const choiceConstructors: Record<ChoiceType, new (name: string) => IChoice> = {
	Template: TemplateChoice,
	Capture: CaptureChoice,
	Macro: MacroChoice,
	Multi: MultiChoice,
};

export function createChoice(type: ChoiceType, name: string): IChoice {
	const Constructor = choiceConstructors[type];
	if (!Constructor) throw new Error(`Unknown choice type: ${type}`);
	return new Constructor(name);
}

/**
 * Recursively duplicates a choice, ensuring unique ids and deep-cloning macros.
 */
export function duplicateChoice(
	choice: IChoice,
	secretSanitizerOptions?: UserScriptSecretSanitizerOptions,
): IChoice {
	const newChoice = createChoice(choice.type, `${choice.name} (copy)`);

	if (choice.type === "Multi") {
		const newMulti = newChoice as IMultiChoice;
		const sourceMulti = choice as IMultiChoice;
		// Preserve command/onePageInput/placeholder/collapsed etc. (symmetry with
		// the other choice types). `choices` is excluded here and set via the
		// recursive map below so children get fresh ids, not the source's.
		Object.assign(newMulti, excludeKeys(sourceMulti, ["id", "name", "choices"]));
		if (hasChildChoices(sourceMulti)) {
			newMulti.choices = childChoicesOf(sourceMulti)
				.filter(isChoiceLike)
				.map((child) => duplicateChoice(child, secretSanitizerOptions));
		} else {
			// The source's children are unreadable. Carry the value across
			// verbatim rather than fabricating [], so the copy is as faithful as
			// the original and the user has two chances to recover it by hand.
			newMulti.choices = sourceMulti.choices;
		}
		return newMulti;
	}

	// copy simple props except id/name
	Object.assign(newChoice, excludeKeys(choice, ["id", "name"]));

	if (choice.type === "Macro") {
		(newChoice as IMacroChoice).macro = deepClone((choice as IMacroChoice).macro);
		regenerateIds((newChoice as IMacroChoice).macro);
		stripUserScriptSecretRefsFromChoice(newChoice, secretSanitizerOptions);
	}

	return newChoice;
}

function collectUserScriptPathsFromCommand(
	command: unknown,
	paths: Set<string>,
): void {
	if (!isRecord(command)) return;

	if (command.type === "UserScript" && typeof command.path === "string") {
		paths.add(command.path);
	}

	if (Array.isArray(command.thenCommands)) {
		for (const child of command.thenCommands) {
			collectUserScriptPathsFromCommand(child, paths);
		}
	}

	if (Array.isArray(command.elseCommands)) {
		for (const child of command.elseCommands) {
			collectUserScriptPathsFromCommand(child, paths);
		}
	}

	collectUserScriptPathsFromChoice(command.choice, paths);
}

export function collectUserScriptPathsFromChoice(
	choice: unknown,
	paths: Set<string>,
): void {
	if (!isRecord(choice)) return;

	if (choice.type === "Macro") {
		// Same reading as the macro builder and the secret sanitizer: an
		// ARRAY-valued `macro` IS the command list (#1609).
		const commands = macroCommandsValueOf(choice.macro);
		if (Array.isArray(commands)) {
			for (const command of commands) {
				collectUserScriptPathsFromCommand(command, paths);
			}
		}
	}

	if (choice.type === "Multi" && Array.isArray(choice.choices)) {
		for (const child of choice.choices) {
			collectUserScriptPathsFromChoice(child, paths);
		}
	}
}

/**
 * Toggle command registration for a choice
 */
export function createToggleCommandChoice(choice: IChoice): IChoice {
	return { ...choice, command: !choice.command };
}

/**
 * Move a choice into a target Multi choice at the end of its list.
 * Prevents cycles (cannot move a Multi into itself or any of its descendants).
 * Returns a new choices array (immutable) suitable for Svelte reactivity.
 */
export function moveChoice(
	rootChoices: IChoice[],
	movingId: string,
	targetMultiId: string,
): IChoice[] {
	if (!movingId || !targetMultiId) return rootChoices;

	const movingChoice = findChoiceById(rootChoices, movingId);
	const targetChoice = findChoiceById(rootChoices, targetMultiId);
	if (!movingChoice || !targetChoice || targetChoice.type !== "Multi") {
		return rootChoices;
	}

	// Prevent cycles: cannot move a Multi into itself or its descendants
	if (movingChoice.type === "Multi") {
		if (movingChoice.id === targetChoice.id) return rootChoices;
		const descendantIds = collectDescendantIds(movingChoice as IMultiChoice);
		if (descendantIds.has(targetChoice.id)) return rootChoices;
	}

	// Remove moving choice from its current location
	const { updated: withoutMoving, removed } = removeChoiceById(rootChoices, movingId);
	if (!removed) return rootChoices; // nothing removed

	// Insert at end of the target multi
	const inserted = insertIntoMulti(withoutMoving, targetMultiId, removed);
	return inserted ?? rootChoices;
}

/**
 * Move a choice OUT of its folder back to the top level (appended at root).
 * Immutable; returns a new roots array. No-op when the choice is missing or is
 * already at the top level. The counterpart to `moveChoice` (which only moves INTO
 * folders) — gives keyboard/menu users a way out that drag offers only via pointer.
 */
export function moveChoiceToRoot(
	rootChoices: IChoice[],
	movingId: string,
): IChoice[] {
	if (!movingId) return rootChoices;

	// Already at root: nothing to do.
	if (rootChoices.some((c) => isChoiceLike(c) && c.id === movingId))
		return rootChoices;

	const { updated: withoutMoving, removed } = removeChoiceById(
		rootChoices,
		movingId,
	);
	if (!removed) return rootChoices;

	return [...withoutMoving, removed];
}

/**
 * Find a choice by id anywhere in the tree (recurses into Multi folders), or
 * undefined. Used to resolve the AUTHORITATIVE live choice before an edit: the
 * row passed from a filtered choice list can be a clone of a Multi holding only
 * the children that matched the filter (see ChoiceView.filterChoices), so editing
 * that clone would drop the folder's non-matching children on save.
 */
export function findChoiceById(choices: IChoice[], id: string): IChoice | undefined {
	for (const c of choices) {
		// A list entry can be a hole (`null`, a primitive) left by a bad edit or a
		// truncated write. Every walker below steps over one rather than throwing
		// on it, so a single hole cannot break an unrelated edit (#1566).
		if (!isChoiceLike(c)) continue;
		if (c.id === id) return c;
		const found = findChoiceById(childChoicesOf(c), id);
		if (found) return found;
	}
	return undefined;
}

function collectDescendantIds(multi: IMultiChoice): Set<string> {
	const ids = new Set<string>();
	const walk = (c: IChoice) => {
		if (!isChoiceLike(c)) return;
		ids.add(c.id);
		childChoicesOf(c).forEach(walk);
	};
	childChoicesOf(multi).forEach(walk);
	return ids;
}

export function removeChoiceById(
	choices: IChoice[],
	id: string,
): { updated: IChoice[]; removed?: IChoice } {
	let removed: IChoice | undefined;
	const updated = choices
		.map((c) => {
			if (!isChoiceLike(c)) return c;
			if (c.id === id) {
				removed = c;
				return undefined;
			}
			// Pass a folder whose children are unreadable through untouched: there
			// is nothing to remove inside it, and rebuilding it would replace the
			// original value with the [] this walker reads it as.
			if (!hasChildChoices(c)) return c;
			const res = removeChoiceById(childChoicesOf(c), id);
			if (res.removed) removed = res.removed;
			if (res.removed) {
				// Only recreate object when children changed
				return { ...(c as IMultiChoice), choices: res.updated } as IChoice;
			}
			return c;
		})
		.filter(Boolean) as IChoice[];

	return { updated, removed };
}

/**
 * Insert `child` at the end of the Multi (folder) with id `targetId`, anywhere
 * in the tree. Immutable and deep (only the touched branch is recreated).
 * Returns a new roots array, or `undefined` if no such folder exists (callers
 * fall back to appending at root). Shared by `moveChoice` and the add-into-folder
 * affordance.
 */
export function insertIntoMulti(
	choices: IChoice[],
	targetId: string,
	child: IChoice,
): IChoice[] | undefined {
	let changed = false;
	const updated = choices.map((c) => {
		if (!isChoiceLike(c)) return c;
		if (c.id === targetId && c.type === "Multi") {
			// Refuse to write into a folder whose existing children we could not
			// read - that write would discard them. The UI offers no add/drop
			// affordance on such a folder (MultiChoiceListItem), so this is the
			// backstop for the paths that reach it another way; returning
			// `undefined` makes the caller fall back rather than destroy.
			if (hasUnreadableChildren(c)) return c;
			changed = true;
			const mc = c as IMultiChoice;
			return { ...mc, choices: [...childChoicesOf(mc), child] } as IChoice;
		}
		if (!hasChildChoices(c)) return c;
		const inner = insertIntoMulti(childChoicesOf(c), targetId, child);
		if (inner) {
			changed = true;
			return { ...(c as IMultiChoice), choices: inner } as IChoice;
		}
		return c;
	});

	return changed ? updated : undefined;
}

/**
 * Immutably insert `newChoice` immediately after the choice with id `afterId`,
 * keeping it in the SAME parent (root or folder) as its sibling. Only the touched
 * branch is recreated (siblings keep their identity). Returns `undefined` when no
 * such sibling exists, so callers can fall back to a root append. Used by the
 * duplicate action so the copy lands next to its source instead of at the bottom
 * of the root list.
 */
export function insertChoiceAfter(
	choices: IChoice[],
	afterId: string,
	newChoice: IChoice,
): IChoice[] | undefined {
	const index = choices.findIndex((c) => isChoiceLike(c) && c.id === afterId);
	if (index !== -1) {
		const updated = [...choices];
		updated.splice(index + 1, 0, newChoice);
		return updated;
	}

	let changed = false;
	const updated = choices.map((c) => {
		if (!isChoiceLike(c) || !hasChildChoices(c)) return c;
		const inner = insertChoiceAfter(
			childChoicesOf(c),
			afterId,
			newChoice,
		);
		if (inner) {
			changed = true;
			return { ...(c as IMultiChoice), choices: inner } as IChoice;
		}
		return c;
	});

	return changed ? updated : undefined;
}

/**
 * Add `newChoice` to the tree: appended at root when `targetFolderId` is
 * undefined, otherwise inserted at the end of that folder AND the folder
 * expanded so the new child is visible. Falls back to a root append if the
 * folder no longer exists. Immutable — shared by the top-bar and per-folder
 * add affordances so the insert/expand/fallback behaviour stays in one place.
 */
export function addChoiceToTree(
	choices: IChoice[],
	newChoice: IChoice,
	targetFolderId?: string,
): IChoice[] {
	if (!targetFolderId) return [...choices, newChoice];

	const inserted = insertIntoMulti(choices, targetFolderId, newChoice) ?? [
		...choices,
		newChoice,
	];
	return expandMultiById(inserted, targetFolderId);
}

/**
 * Immutably update a Multi (folder) by id, anywhere in the tree: replace the folder
 * whose id matches with `patch(folder)`, recreating only the touched branch (siblings
 * keep their identity). Reassigning the result into the choices `$state` is what makes
 * the edit REACTIVE — an in-place `folder.<field> = …` mutation isn't tracked until the
 * array has been proxied by a reassignment, so on first render (the plain array mounted
 * from the store) the change wouldn't show until some later reassignment. Shared walker
 * behind setMultiCollapsedById / setFolderChildrenById.
 */
export function updateMultiById(
	choices: IChoice[],
	id: string,
	patch: (folder: IMultiChoice) => IMultiChoice,
): IChoice[] {
	return choices.map((c) => {
		if (!isChoiceLike(c) || c.type !== "Multi") return c;
		const mc = c as IMultiChoice;
		if (mc.id === id) return patch(mc);
		// A folder whose children are unreadable comes out byte-identical. This
		// walker re-spreads EVERY folder it passes, and it is on the save path
		// (collapse a folder, rename a leaf), so substituting the read accessor
		// here would quietly persist [] over the preserved value (#1566).
		if (!hasChildChoices(mc)) return c;
		return { ...mc, choices: updateMultiById(childChoicesOf(mc), id, patch) } as IChoice;
	});
}

/** Immutably set a Multi (folder)'s `collapsed` flag by id (see updateMultiById). */
export function setMultiCollapsedById(
	choices: IChoice[],
	id: string,
	collapsed: boolean,
): IChoice[] {
	return updateMultiById(choices, id, (mc) => ({ ...mc, collapsed }));
}

function expandMultiById(choices: IChoice[], id: string): IChoice[] {
	return setMultiCollapsedById(choices, id, false);
}

/**
 * Immutably replace a Multi (folder)'s children by id, anywhere in the tree.
 * Used to commit a nested drag/reorder against the AUTHORITATIVE root tree by id —
 * not by mutating a `choice` prop reference, which goes stale within a synchronous
 * cross-zone drag finalize (the root zone reassigns the tree first, so the folder
 * zone's `choice` no longer points at the folder in the live tree -> duplication).
 * CO-DEPENDENT with the DROPPED_INTO_ANOTHER source-strip in ChoiceList.handleSort —
 * the strip alone is insufficient at depth >= 2; both are load-bearing.
 */
export function setFolderChildrenById(
	choices: IChoice[],
	folderId: string,
	children: IChoice[],
): IChoice[] {
	return updateMultiById(choices, folderId, (mc) => ({ ...mc, choices: children }));
}
