import { Notice, type App } from "obsidian";
import type { ChoiceType } from "src/types/choices/choiceType";
import { CaptureChoiceBuilder } from "../gui/ChoiceBuilder/captureChoiceBuilder";
import { TemplateChoiceBuilder } from "../gui/ChoiceBuilder/templateChoiceBuilder";
import GenericYesNoPrompt from "../gui/GenericYesNoPrompt/GenericYesNoPrompt";
import { MacroBuilder } from "../gui/MacroGUIs/MacroBuilder";
import { MultiChoiceSettingsModal } from "../gui/MultiChoiceSettingsModal";
import type QuickAdd from "../main";
import { settingsStore } from "../settingsStore";
import { CaptureChoice } from "../types/choices/CaptureChoice";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type IChoice from "../types/choices/IChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import { MacroChoice } from "../types/choices/MacroChoice";
import { MultiChoice } from "../types/choices/MultiChoice";
import { TemplateChoice } from "../types/choices/TemplateChoice";
import { regenerateIds } from "../utils/macroUtils";
import { flattenChoices } from "../utils/choiceUtils";
import { excludeKeys } from "../utils/excludeKeys";
import { deepClone } from "../utils/deepClone";
import {
	clearUserScriptSecretsFromCommand,
	detectUserScriptSecretOptions,
	stripUserScriptSecretRefsFromChoice,
} from "../utils/userScriptSecrets";
import type { UserScriptSecretSanitizerOptions } from "../utils/userScriptSecrets";
import { log } from "../logger/logManager";

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
		newMulti.choices = sourceMulti.choices.map((child) =>
			duplicateChoice(child, secretSanitizerOptions)
		);
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

export async function duplicateChoiceWithUserScriptSecretSanitization(
	choice: IChoice,
	app: App,
): Promise<IChoice> {
	const secretOptionNamesByPath = await buildSecretOptionNamesByPath(app, choice);

	return duplicateChoice(choice, {
		secretOptionNamesByPath,
		stripUnknownStringSettings: true,
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
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

function collectUserScriptPathsFromChoice(
	choice: unknown,
	paths: Set<string>,
): void {
	if (!isRecord(choice)) return;

	if (choice.type === "Macro" && isRecord(choice.macro)) {
		const commands = choice.macro.commands;
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

async function buildSecretOptionNamesByPath(
	app: App,
	choice: IChoice,
): Promise<Map<string, ReadonlySet<string> | null>> {
	const paths = new Set<string>();
	collectUserScriptPathsFromChoice(choice, paths);
	const secretOptionNamesByPath = new Map<string, ReadonlySet<string> | null>();

	for (const path of paths) {
		try {
			const exists = await app.vault.adapter.exists(path);
			if (!exists) continue;

			const detection = detectUserScriptSecretOptions(
				await app.vault.adapter.read(path),
				path,
			);
			secretOptionNamesByPath.set(
				path,
				detection.foundSecretOptions && detection.names.size === 0
					? null
					: detection.names,
			);
		} catch (error) {
			log.logWarning(
				`QuickAdd could not inspect user-script settings '${path}' while duplicating choice: ${
					(error as Error)?.message ?? error
				}`,
			);
		}
	}

	return secretOptionNamesByPath;
}

/**
 * Get the appropriate builder for a choice
 */
export function getChoiceBuilder(
	choice: IChoice,
	app: App,
	plugin: QuickAdd,
): TemplateChoiceBuilder | CaptureChoiceBuilder | MacroBuilder | undefined {
	type Builder =
		| TemplateChoiceBuilder
		| CaptureChoiceBuilder
		| MacroBuilder
		| undefined;

	const builderFactory: Record<ChoiceType, () => Builder> = {
		Template: () =>
			new TemplateChoiceBuilder(app, choice as ITemplateChoice, plugin),
		Capture: () =>
			new CaptureChoiceBuilder(app, choice as ICaptureChoice, plugin),
		Macro: () =>
			new MacroBuilder(
				app,
				plugin,
				choice as IMacroChoice,
				settingsStore.getState().choices,
			),
		Multi: () => undefined,
	};

	const creator = builderFactory[choice.type];
	return typeof creator === "function" ? creator() : undefined;
}

/**
 * Handle choice deletion with confirmation
 */
export async function deleteChoiceWithConfirmation(
	choice: IChoice,
	app: App,
): Promise<boolean> {
	const isMulti = choice.type === "Multi";
	const isMacro = choice.type === "Macro";

	// Count the FULL subtree (flattenChoices includes the folder itself, so drop it),
	// not just direct children — a recursive delete removes everything nested. Special-
	// case 0 (no scary "delete all (0) choices") and pluralize correctly.
	const buildMultiWarning = (multi: IMultiChoice): string => {
		const descendantCount = flattenChoices(multi.choices).length;
		if (descendantCount === 0) return "";
		const noun = descendantCount === 1 ? "choice" : "choices";
		return `Deleting this choice will delete all (${descendantCount}) ${noun} inside it (including nested folders)!`;
	};

	const userConfirmed: boolean = await GenericYesNoPrompt.Prompt(
		app,
		`Confirm deletion of choice`,
		`Please confirm that you wish to delete '${choice.name}'.
            ${isMulti ? buildMultiWarning(choice as IMultiChoice) : ""}
            ${isMacro
			? "Deleting this choice will delete its macro commands!"
			: ""
		}
            `,
	);

	if (!userConfirmed) return false;

	if (isMacro || isMulti) {
		const cleared = await clearUserScriptSecretsFromCommand(app, {
			type: "NestedChoice",
			choice,
		});
		if (!cleared) {
			new Notice("Could not clear user script secrets. Choice was not deleted.");
			return false;
		}
	}

	return true;
}

/**
 * Configure a choice through its builder
 */
export async function configureChoice(
	choice: IChoice,
	app: App,
	plugin: QuickAdd,
): Promise<IChoice | undefined> {
	if (choice.type === "Multi") {
		try {
			return await new MultiChoiceSettingsModal(
				app,
				choice as IMultiChoice,
			).waitForClose;
		} catch {
			return undefined;
		}
	}

	const builder = getChoiceBuilder(choice, app, plugin);
	if (!builder) {
		throw new Error("Invalid choice type");
	}

	return await builder.waitForClose;
}

/**
 * Toggle command registration for a choice
 */
export function createToggleCommandChoice(choice: IChoice): IChoice {
	return { ...choice, command: !choice.command };
}

/**
 * Command registry adapter to decouple plugin interactions
 */
export class CommandRegistry {
	constructor(private plugin: QuickAdd) { }

	enableCommand(choice: IChoice): void {
		this.plugin.addCommandForChoice(choice);
	}

	disableCommand(choice: IChoice, options?: { recursive?: boolean }): void {
		// Pass `recursive` through only when supplied (a folder DELETE) so the
		// common, non-recursive case keeps its single-argument call shape.
		if (options) {
			this.plugin.removeCommandForChoice(choice, options);
		} else {
			this.plugin.removeCommandForChoice(choice);
		}
	}

	updateCommand(oldChoice: IChoice, newChoice: IChoice): void {
		// Non-recursive remove: the children remain and addCommandForChoice below
		// re-registers any command-enabled descendants of newChoice.
		this.plugin.removeCommandForChoice(oldChoice);
		this.plugin.addCommandForChoice(newChoice);
	}
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
	if (rootChoices.some((c) => c.id === movingId)) return rootChoices;

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
		if (c.id === id) return c;
		if (c.type === "Multi") {
			const found = findChoiceById((c as IMultiChoice).choices, id);
			if (found) return found;
		}
	}
	return undefined;
}

function collectDescendantIds(multi: IMultiChoice): Set<string> {
	const ids = new Set<string>();
	const walk = (c: IChoice) => {
		ids.add(c.id);
		if (c.type === "Multi") (c as IMultiChoice).choices.forEach(walk);
	};
	(multi.choices ?? []).forEach(walk);
	return ids;
}

export function removeChoiceById(
	choices: IChoice[],
	id: string,
): { updated: IChoice[]; removed?: IChoice } {
	let removed: IChoice | undefined;
	const updated = choices
		.map((c) => {
			if (c.id === id) {
				removed = c;
				return undefined;
			}
			if (c.type !== "Multi") return c;
			const res = removeChoiceById((c as IMultiChoice).choices, id);
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
		if (c.id === targetId && c.type === "Multi") {
			changed = true;
			const mc = c as IMultiChoice;
			return { ...mc, choices: [...mc.choices, child] } as IChoice;
		}
		if (c.type !== "Multi") return c;
		const inner = insertIntoMulti((c as IMultiChoice).choices, targetId, child);
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
	const index = choices.findIndex((c) => c.id === afterId);
	if (index !== -1) {
		const updated = [...choices];
		updated.splice(index + 1, 0, newChoice);
		return updated;
	}

	let changed = false;
	const updated = choices.map((c) => {
		if (c.type !== "Multi") return c;
		const inner = insertChoiceAfter(
			(c as IMultiChoice).choices,
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
		if (c.type !== "Multi") return c;
		const mc = c as IMultiChoice;
		if (mc.id === id) return patch(mc) as IChoice;
		return { ...mc, choices: updateMultiById(mc.choices, id, patch) } as IChoice;
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
