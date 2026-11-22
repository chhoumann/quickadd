import { Notice, type App } from "obsidian";
import { tick } from "svelte";
import type { ChoiceBuilderPlugin, ChoiceCommandRegistrar } from "../../types/pluginContext";
import type IChoice from "../../types/choices/IChoice";
import type IMultiChoice from "../../types/choices/IMultiChoice";
import type { ChoiceType } from "../../types/choices/choiceType";
import {
	createChoice,
	createToggleCommandChoice,
	findChoiceById,
	addChoiceToTree,
	insertChoiceAfter,
	moveChoice as moveChoiceService,
	moveChoiceToRoot,
	removeChoiceById,
	setFolderChildrenById,
	setMultiCollapsedById,
} from "../../services/choiceTree";
import {
	configureChoice,
	deleteChoiceWithConfirmation,
	duplicateChoiceWithUserScriptSecretSanitization,
} from "./choiceUiService";
import { log } from "../../logger/logManager";
import { choiceNoun } from "../../utils/choiceNoun";
import { reportingHandler } from "../../utils/errorUtils";
import { type Plain, snapshot } from "../svelte/persist.svelte";
import { promptRenameChoice } from "../choiceRename";
import { MOVE_TO_ROOT_TARGET_ID } from "./contextMenu";
import { uniqueDefaultChoiceName } from "./choiceTypeMeta";
import type { ChoiceListActions } from "./choiceListActions";
import { subtreeHasCommand, updateChoiceHelper } from "./choiceViewTree";
import { threeWayMergeSettings } from "../../utils/settingsPersistMerge";
import { settingsStore } from "../../settingsStore";

interface ChoiceViewContext {
	app: App;
	plugin: ChoiceBuilderPlugin;
	choices: IChoice[];
	filterQuery: string;
	commands: ChoiceCommandRegistrar;
	saveChoices: (choices: Plain<IChoice[]>) => void;
}

/** Access live component state after every await, so intervening store writes survive. */
export function createChoiceViewActions(context: ChoiceViewContext): ChoiceListActions {
	function save() {
		context.saveChoices(snapshot(context.choices));
	}

	// Non-recursive remove: the children stay, and adding the new choice
	// re-registers its command-enabled descendants.
	function replaceCommand(oldChoice: IChoice, newChoice: IChoice) {
		context.commands.removeCommandForChoice(oldChoice);
		context.commands.addCommandForChoice(newChoice);
	}

	async function addChoiceToList(
		_name: string,
		type: ChoiceType,
		targetFolderId?: string,
		skipConfigure = false,
	): Promise<void> {
		const name = uniqueDefaultChoiceName(type, context.choices);
		const newChoice = createChoice(type, name);
		context.choices = addChoiceToTree(context.choices, newChoice, targetFolderId);

		// A root-level add while a filter is active would otherwise look like
		// nothing happened (the auto-named choice may not match the filter).
		if (!targetFolderId && context.filterQuery.trim().length > 0) {
			context.filterQuery = "";
		}

		// Persist before opening any editor: an external store write can arrive while
		// it is open. Cancellation keeps the saved default-named choice.
		save();
		if (type === "Multi") {
			await handleRenameChoice(newChoice);
		} else if (!skipConfigure) {
			try {
				// The builder opens over this list, which shows it again when left.
				if (handleConfigureChoice(newChoice)) return;
			} catch (err) {
				log.logError(
					`Failed to configure the new choice: ${err instanceof Error ? err.message : String(err)}`,
				);
				save();
			}
		}
		await revealChoice(newChoice.id);
	}

	// Scroll a just-added row into view so the add never "looks like nothing
	// happened" (a new root choice otherwise lands at the bottom of a long list
	// while the viewport stays at the top).
	async function revealChoice(id: string): Promise<void> {
		await tick();
		try {
			document
				.querySelector(`[data-choice-id="${id}"]`)
				?.scrollIntoView({ block: "nearest" });
		} catch {
			// jsdom / no-layout environments don't implement scrollIntoView.
		}
	}

	// The row passed from the list can be a filtered-view CLONE of a Multi holding
	// only the children that matched the filter (see filterChoices). Resolve the
	// AUTHORITATIVE live choice by id before any edit/duplicate/delete-count, so a
	// folder's hidden children are never dropped or miscounted on save.
	function liveChoice(choice: IChoice): IChoice {
		return findChoiceById(context.choices, choice.id) ?? choice;
	}

	async function deleteChoice(choice: IChoice) {
		const target = liveChoice(choice);
		const userConfirmed = await deleteChoiceWithConfirmation(target, context.app);
		if (!userConfirmed) return;

		// Immutable removal at any depth — so the delete is reactive on the runes
		// $state array without relying on the top-array reassignment to heal an
		// in-place nested mutation (which would silently fail for a nested-only delete).
		context.choices = removeChoiceById(context.choices, choice.id).updated;
		// Deleting removes the subtree, so unregister descendants' commands too,
		// from the live `target`: with a filter active, `choice` can be a truncated
		// clone.
		context.commands.removeCommandForChoice(target, { recursive: true });
		save();
	}

	/** Opens the builder page. Returns false if it could not open. */
	function handleConfigureChoice(oldChoice: IChoice): boolean {
		// A builder saves each time the app goes to the background and once more
		// when it is left; say a deletion elsewhere once.
		let toldDeleted = false;
		return configureChoice(liveChoice(oldChoice), context.app, context.plugin, (edited, base) =>
			// Obsidian logs and swallows a throw from a page's hide(); say it.
			reportingHandler(`Couldn't save the ${choiceNoun(base.type)} “${base.name}”`, () => {
				if (saveBuilderEdits(base, edited) || toldDeleted) return;
				toldDeleted = true;
				new Notice(`QuickAdd: “${base.name}” was deleted elsewhere, so your changes to it were not saved.`);
			})(),
		);
	}

	// The builder is a settings page, and Obsidian tears this view down while it
	// is open, so this reads and writes the store rather than the view's copy.
	// Settings synced from another device apply while the builder is open, so
	// merge: a save only writes what was edited since the last one. Returns
	// false, saving nothing, if the choice was deleted elsewhere.
	function saveBuilderEdits(base: IChoice, edited: IChoice): boolean {
		const choices = settingsStore.getState().choices;
		const current = findChoiceById(choices, base.id);
		if (!current) return false;
		const updatedChoice = threeWayMergeSettings<IChoice>(base, edited, snapshot(current));
		context.saveChoices(snapshot(choices.map((choice) => updateChoiceHelper(choice, updatedChoice))));
		replaceCommand(current, updatedChoice);
		return true;
	}

	async function handleRenameChoice(choice: IChoice) {
		if (!choice) return;

		const newName = await promptRenameChoice(context.app, choice.name, choice.type);
		if (!newName) return;

		const live = findChoiceById(context.choices, choice.id);
		if (!live) {
			new Notice(`QuickAdd: “${choice.name}” was deleted elsewhere, so it was not renamed.`);
			return;
		}
		const updatedChoice = { ...live, name: newName };
		context.choices = context.choices.map((entry) => updateChoiceHelper(entry, updatedChoice));
		replaceCommand(live, updatedChoice);
		save();
	}

	function toggleCommandForChoice(oldChoice: IChoice) {
		const updatedChoice = createToggleCommandChoice(liveChoice(oldChoice));

		context.choices = context.choices.map((choice) => updateChoiceHelper(choice, updatedChoice));
		if (updatedChoice.command) {
			context.commands.addCommandForChoice(updatedChoice);
		} else {
			context.commands.removeCommandForChoice(updatedChoice);
		}
		save();
	}

	async function handleDuplicateChoice(sourceChoice: IChoice) {
		const newChoice = await duplicateChoiceWithUserScriptSecretSanitization(
			liveChoice(sourceChoice),
			context.app,
		);
		// Insert the copy right after its source (same parent folder), not at the
		// bottom of the root list — so duplicating a nested row produces a visible,
		// adjacent copy. Fall back to a root append if the source can't be located.
		context.choices =
			insertChoiceAfter(context.choices, sourceChoice.id, newChoice) ?? [
				...context.choices,
				newChoice,
			];
		// Register the duplicate's commands now so the copy works from the palette
		// before a reload; addCommandForChoice recurses into children.
		if (subtreeHasCommand(newChoice)) {
			context.commands.addCommandForChoice(newChoice);
		}
		save();
		new Notice(`Duplicated "${sourceChoice.name}".`);
		await revealChoice(newChoice.id);
	}

	function handleMoveChoice(choice: IChoice, targetId: string) {
		// The "Move to: (root)" menu item routes through onMove with a sentinel id
		// (no real folder target exists for root), so re-append at the top level.
		context.choices =
			targetId === MOVE_TO_ROOT_TARGET_ID
				? moveChoiceToRoot(context.choices, choice.id)
				: moveChoiceService(context.choices, choice.id, targetId);
		save();
	}

	function handleReorderChoices(reordered: IChoice[]) {
		context.choices = reordered;
		save();
	}

	// Commit a folder's children by id: a nested drag's `choice` reference goes
	// stale across zones, which duplicated rows.
	function handleCommitFolder(folderId: string, children: IChoice[]) {
		context.choices = setFolderChildrenById(context.choices, folderId, children);
		save();
	}

	// Reassign immutably so the collapse is reactive; an in-place mutation is not
	// tracked until the array has been proxied by a reassignment.
	function handleToggleCollapsed(choice: IChoice) {
		context.choices = setMultiCollapsedById(
			context.choices,
			choice.id,
			!(choice as IMultiChoice).collapsed,
		);
		save();
	}

	// Every row button, menu item and nested list reaches these handlers through
	// this one bag, so wrapping here covers paths hand-wrapping would miss. The
	// message uses the row's own noun and name, degrading for a malformed entry
	// rather than printing "undefined".
	function rowAction<Rest extends unknown[]>(
		verb: string,
		fn: (choice: IChoice, ...rest: Rest) => unknown,
	): (choice: IChoice, ...rest: Rest) => void {
		return (choice, ...rest) => {
			const noun = choiceNoun(choice?.type);
			const subject = choice?.name
				? `the ${noun} “${choice.name}”`
				: `that ${noun}`;
			reportingHandler(`Couldn't ${verb} ${subject}`, fn)(choice, ...rest);
		};
	}

	return {
		onDeleteChoice: rowAction("delete", deleteChoice),
		onConfigureChoice: rowAction("open the settings for", handleConfigureChoice),
		onToggleCommand: rowAction(
			"update the command palette entry for",
			toggleCommandForChoice,
		),
		onDuplicateChoice: rowAction("duplicate", handleDuplicateChoice),
		onRenameChoice: rowAction("rename", handleRenameChoice),
		onMoveChoice: rowAction("move", handleMoveChoice),
		onToggleCollapsed: rowAction("open or close", handleToggleCollapsed),
		onReorderChoices: reportingHandler(
			"Couldn't save the new order",
			handleReorderChoices,
		),
		onCommitFolder: reportingHandler(
			"Couldn't save that folder's contents",
			handleCommitFolder,
		),
		// Same noun rule, from the type being added rather than an existing row.
		onAddChoice: (name, type, targetFolderId, skipConfigure) =>
			reportingHandler(`Couldn't add that ${choiceNoun(type)}`, addChoiceToList)(
				name,
				type,
				targetFolderId,
				skipConfigure,
			),
	};

}
