import { Notice, type App } from "obsidian";
import { tick } from "svelte";
import type QuickAdd from "../../main";
import type IChoice from "../../types/choices/IChoice";
import type IMultiChoice from "../../types/choices/IMultiChoice";
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
import { reportingHandler, reportUnlessCancelled } from "../../utils/errorUtils";
import { type Plain, snapshot } from "../svelte/persist.svelte";
import { promptRenameChoice } from "../choiceRename";
import { MOVE_TO_ROOT_TARGET_ID } from "./contextMenu";
import { createFromPreset, FOLDER_NAME, type Preset } from "./presets";
import { uniqueChoiceName } from "./uniqueChoiceName";
import { DEFAULT_TEMPLATE_FOLDER, type FirstRunPlan, readTemplateFolder } from "./firstRun";
import { ensureParentFolders } from "../../utils/ensureParentFolders";
import type { ChoiceListActions } from "./choiceListActions";
import { replaceChoiceHelper, subtreeHasCommand, updateChoiceHelper } from "./choiceViewTree";
import { threeWayMergeSettings } from "../../utils/settingsPersistMerge";
import { settingsStore } from "../../settingsStore";
import { withStep } from "../../v3/addStep";
import type { Step } from "../../v3/model";
import { backOutOfBuilderPages } from "../ChoiceBuilder/builderPage";
import { ImportPackageModal } from "../PackageManager/ImportPackageModal";
import { RecipesModal } from "../recipes/RecipesModal";

interface ChoiceViewContext {
	app: App;
	plugin: QuickAdd;
	choices: IChoice[];
	filterQuery: string;
	commandRegistry: CommandRegistry;
	saveChoices: (choices: Plain<IChoice[]>) => void;
}

/** Access live component state after every await, so intervening store writes survive. */
export function createChoiceViewActions(context: ChoiceViewContext): ChoiceListActions & {
	onCreateFirstRun: (plan: FirstRunPlan) => Promise<void>;
	onBrowseRecipes: () => void;
	onImportPackage: () => void;
} {
	// Persist the current choices as a plain (non-proxy) snapshot.
	function save() {
		context.saveChoices(snapshot(context.choices));
	}

	function choiceFromPreset(preset: Preset): IChoice {
		const templateFolder = readTemplateFolder(context.app, settingsStore.getState()) ?? DEFAULT_TEMPLATE_FOLDER;
		const newChoice = createFromPreset(preset, { templateFolder });
		newChoice.name = uniqueChoiceName(preset.name, context.choices);
		// The outcome's icon, not the type's, so the list and launcher read by it.
		newChoice.icon = preset.iconId;
		return newChoice;
	}

	async function addChoiceToList(
		preset: Preset,
		targetFolderId?: string,
		skipConfigure = false,
	): Promise<void> {
		const newChoice = choiceFromPreset(preset);
		insert(newChoice, targetFolderId);
		if (!skipConfigure) {
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

	// The first run's choices: the files they need, never over one that exists,
	// then the choices at the root, saved once, with no builder.
	async function createFirstRun(plan: FirstRunPlan): Promise<void> {
		const { vault } = context.app;
		for (const file of plan.files) {
			if (await vault.adapter.exists(file.path)) continue;
			await ensureParentFolders(context.app, file.path);
			await vault.create(file.path, file.content);
		}
		for (const choice of plan.choices) {
			choice.name = uniqueChoiceName(choice.name, context.choices);
			context.choices = addChoiceToTree(context.choices, choice);
		}
		save();
	}

	async function addFolderToList(targetFolderId?: string): Promise<void> {
		const folder = createChoice("Multi", uniqueChoiceName(FOLDER_NAME, context.choices));
		insert(folder, targetFolderId);
		await handleRenameChoice(folder);
		await revealChoice(folder.id);
	}

	function insert(newChoice: IChoice, targetFolderId?: string) {
		context.choices = addChoiceToTree(context.choices, newChoice, targetFolderId);

		// A root-level add while a filter is active would otherwise look like
		// nothing happened (the auto-named choice may not match the filter).
		if (!targetFolderId && context.filterQuery.trim().length > 0) {
			context.filterQuery = "";
		}

		// Persist before opening any editor: an external store write can arrive while
		// it is open. Cancellation keeps the saved default-named choice.
		save();
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

	/** Opens the builder page. Returns false if it could not open. */
	function handleConfigureChoice(oldChoice: IChoice): boolean {
		return openBuilder(liveChoice(oldChoice));
	}

	function openBuilder(choice: IChoice): boolean {
		// A builder saves each time the app goes to the background and once more
		// when it is left; say a deletion elsewhere once.
		let toldDeleted = false;
		return configureChoice(
			choice,
			context.app,
			context.plugin,
			(edited, base) =>
				// Obsidian logs and swallows a throw from a page's hide(); say it.
				reportingHandler(`Couldn't save the ${choiceNoun(base.type)} “${base.name}”`, () => {
					if (saveBuilderEdits(base, edited) || toldDeleted) return;
					toldDeleted = true;
					new Notice(`QuickAdd: “${base.name}” was deleted elsewhere, so your changes to it were not saved.`);
				})(),
			{ onAddStep: reportingHandler("Couldn't add that step", (step: Step) => addStepToChoice(choice.id, step)) },
		);
	}

	// The Template or Capture builder saved before handing the choice over. It
	// becomes a Macro, which replaces it whole (a merge would keep the old
	// type's settings on it), and the macro builder takes over from the page.
	function addStepToChoice(id: string, step: Step): void {
		const choices = settingsStore.getState().choices;
		const current = findChoiceById(choices, id);
		if (!current) {
			new Notice("QuickAdd: That choice was deleted elsewhere, so no step was added.");
			return;
		}
		const converted = withStep(current, step);
		context.saveChoices(snapshot(choices.map((choice) => replaceChoiceHelper(choice, converted))));
		context.commandRegistry.updateCommand(current, converted);
		backOutOfBuilderPages(context.app);
		openBuilder(converted);
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
		context.commandRegistry.updateCommand(current, updatedChoice);
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
		onAddChoice: reportingHandler("Couldn't add that choice", addChoiceToList),
		onAddFolder: reportingHandler("Couldn't add that folder", addFolderToList),
		onBrowseRecipes: () => new RecipesModal(context.app, context.plugin).open(),
		onImportPackage: () => new ImportPackageModal(context.app, context.plugin).open(),
		// Settles either way, so the view can hold its button while it runs.
		onCreateFirstRun: (plan: FirstRunPlan) =>
			createFirstRun(plan).catch((err: unknown) => {
				reportUnlessCancelled(err, "Couldn't create those choices");
			}),
	};

}
