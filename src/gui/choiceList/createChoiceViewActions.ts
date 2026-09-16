import { Notice, type App } from "obsidian";
import { tick } from "svelte";
import type QuickAdd from "../../main";
import type IChoice from "../../types/choices/IChoice";
import type IMultiChoice from "../../types/choices/IMultiChoice";
import type { ChoiceType } from "../../types/choices/choiceType";
import {
	type CommandRegistry,
	configureChoice,
	createChoice,
	createToggleCommandChoice,
	findChoiceById,
	deleteChoiceWithConfirmation,
	duplicateChoiceWithUserScriptSecretSanitization,
	addChoiceToTree,
	insertChoiceAfter,
	moveChoice as moveChoiceService,
	moveChoiceToRoot,
	removeChoiceById,
	setFolderChildrenById,
	setMultiCollapsedById,
} from "../../services/choiceService";
import { log } from "../../logger/logManager";
import { choiceNoun } from "../../utils/choiceNoun";
import { reportingHandler } from "../../utils/errorUtils";
import { type Plain, snapshot } from "../svelte/persist.svelte";
import { promptRenameChoice } from "../choiceRename";
import { MOVE_TO_ROOT_TARGET_ID } from "./contextMenu";
import { uniqueDefaultChoiceName } from "./choiceTypeMeta";
import type { ChoiceListActions } from "./choiceListActions";
import { subtreeHasCommand, updateChoiceHelper } from "./choiceViewTree";

interface ChoiceViewContext {
	app: App;
	plugin: QuickAdd;
	choices: IChoice[];
	filterQuery: string;
	commandRegistry: CommandRegistry;
	saveChoices: (choices: Plain<IChoice[]>) => void;
}

/** Access live component state after every await, so intervening store writes survive. */
export function createChoiceViewActions(context: ChoiceViewContext): ChoiceListActions {
	// Persist the current choices as a plain (non-proxy) snapshot.
	function save() {
		context.saveChoices(snapshot(context.choices));
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
				await handleConfigureChoice(newChoice);
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
		// Deleting removes the whole subtree, so recursively unregister the
		// commands of any command-enabled descendants too (toggling a folder's
		// own command off, by contrast, must leave its children registered).
		// Use the resolved live `target`, not `choice`: with an active filter the
		// passed `choice` can be a truncated clone (only matching children), which
		// would otherwise leave hidden command-enabled descendants orphaned.
		context.commandRegistry.disableCommand(target, { recursive: true });
		save();
	}

	async function handleConfigureChoice(oldChoice: IChoice) {
		const live = liveChoice(oldChoice);
		const updatedChoice = await configureChoice(live, context.app, context.plugin);
		if (!updatedChoice) return;

		context.choices = context.choices.map((choice) => updateChoiceHelper(choice, updatedChoice));
		context.commandRegistry.updateCommand(live, updatedChoice);
		save();
	}


	async function handleRenameChoice(choice: IChoice) {
		if (!choice) return;

		const newName = await promptRenameChoice(context.app, choice.name, choice.type);
		if (!newName) return;

		const live = liveChoice(choice);
		const updatedChoice = { ...live, name: newName };
		context.choices = context.choices.map((entry) => updateChoiceHelper(entry, updatedChoice));
		context.commandRegistry.updateCommand(live, updatedChoice);
		save();
	}

	function toggleCommandForChoice(oldChoice: IChoice) {
		const updatedChoice = createToggleCommandChoice(liveChoice(oldChoice));

		context.choices = context.choices.map((choice) => updateChoiceHelper(choice, updatedChoice));
		if (updatedChoice.command) {
			context.commandRegistry.enableCommand(updatedChoice);
		} else {
			context.commandRegistry.disableCommand(updatedChoice);
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
		// A duplicate carries command:true when its source did; register its command so
		// the copy is immediately usable from the palette instead of only appearing
		// command-enabled until the next plugin reload. enableCommand -> addCommandForChoice
		// recurses into a folder's children, so registering once covers any command-enabled
		// descendants too. Gate on the subtree actually containing a command so we never
		// touch the registry for a command-less folder.
		if (subtreeHasCommand(newChoice)) {
			context.commandRegistry.enableCommand(newChoice);
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

	// Commit a folder's children by id into ChoiceView's authoritative tree. A nested
	// drag/reorder calls this rather than relying on its (cross-zone-stale) `choice`
	// reference — finding the folder by id keeps the edit on the real live node, which
	// is what fixes the root<->folder drag duplication. See onCommitFolder.
	function handleCommitFolder(folderId: string, children: IChoice[]) {
		context.choices = setFolderChildrenById(context.choices, folderId, children);
		save();
	}

	// Reassign the tree immutably (by id, any depth) so the collapse is REACTIVE —
	// an in-place `choice.collapsed = …` isn't tracked until the array is proxied by
	// a reassignment, which is why folders wouldn't toggle on first render. save()
	// also re-seeds choices from the store (proxied), healing reactivity thereafter.
	function handleToggleCollapsed(choice: IChoice) {
		context.choices = setMultiCollapsedById(
			context.choices,
			choice.id,
			!(choice as IMultiChoice).collapsed,
		);
		save();
	}

	// Every row button, context-menu item and nested list reaches these handlers
	// through this one bag (MultiChoiceListItem's nestedActions spreads it), so
	// wrapping it here is what makes a failing row action impossible to miss —
	// hand-wrapping the call sites would silently skip the nested and menu paths.
	//
	// The message is built from the ROW: its own noun, so a folder is never called
	// a choice (see choiceNoun; #1552), and its name, so a user with a long list
	// knows which row the Notice is about. A malformed entry can have neither, so
	// both degrade rather than printing "undefined".
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
