import type IChoice from "src/types/choices/IChoice";
import type { IMacro } from "src/types/macros/IMacro";
import { isCaptureChoice } from "./helpers/isCaptureChoice";
import { isMultiChoice } from "./helpers/isMultiChoice";
import { isNestedChoiceCommand } from "./helpers/isNestedChoiceCommand";
import type { Migration, MigrationResult } from "./Migrations";
import { deepClone } from "src/utils/deepClone";
import type QuickAdd from "src/main";
import { treeHasUnreadableChildren } from "src/utils/choiceUtils";
import {
	commandListOf,
	isUnreadableCommandList,
	macroCommandsValueOf,
	rootMacrosOf,
} from "src/utils/macroUtils";

type SettingsWithLegacyMacros = QuickAdd["settings"] & { macros?: IMacro[] };

function recursiveMigrateSettingInChoices(choices: IChoice[]): IChoice[] {
	for (const choice of choices) {
		if (isMultiChoice(choice)) {
			choice.choices = recursiveMigrateSettingInChoices(choice.choices);
		}

		if (isCaptureChoice(choice)) {
			// `insertAfter` may be absent on legacy/imported/hand-edited choices;
			// migrations run on raw settings before CaptureChoice.Load normalizes
			// them. Treat a missing object as not-enabled instead of throwing.
			if (choice.insertAfter?.enabled && choice.prepend) {
				choice.prepend = false;
			}
		}
	}

	return choices;
}

function migrateSettingsInMacros(macros: IMacro[]): IMacro[] {
		// `macros` is untrusted end to end, not just at its root: a hole (`null`, a
		// stray primitive) survives a truncated write and must be stepped over
		// rather than dereferenced, and an ARRAY-valued macro IS its command list
		// (#1593). Both reach `macro.commands` otherwise, and the TypeError aborts
		// the whole migration - caught, reverted, and reported with a 15-second
		// "please create an issue" notice on every launch.
	for (const macro of macros) {
		for (const command of commandListOf(macroCommandsValueOf(macro))) {
			if (
				isNestedChoiceCommand(command) &&
				isCaptureChoice(command.choice)
			) {
				if (
					command.choice.insertAfter?.enabled &&
					command.choice.prepend
				) {
					command.choice.prepend = false;
				}
			}
		}
	}

	return macros;
}

const mutualExclusionInsertAfterAndWriteToBottomOfFile: Migration = {
	description:
		"Mutual exclusion of insertAfter and writeToBottomOfFile settings. If insertAfter is enabled, writeToBottomOfFile is disabled. To support changes in settings UI.",
	 
	migrate: async (plugin): Promise<MigrationResult | void> => {
		const settings = plugin.settings as SettingsWithLegacyMacros;

		// Never rewrite a corrupt root with []: that [] would be persisted on the
		// next save and destroy what a user needs to recover by hand (#1566). The
		// choices half simply has not run, so stay PENDING - migrations are flagged
		// once and never retried, and a vault repaired by hand deserves to be
		// migrated. The macros half below is independent and still runs.
		// This migration recurses `Multi.choices` itself and walks the legacy
		// `settings.macros` separately, so it asks the FOLDERS-ONLY question plus
		// "can I read the macros container at all" - blocking it on a `macro.commands`
		// inside the CHOICE tree, which it never descends, would strand it for
		// nothing (#1610).
		//
		// Knowingly narrower than its own traversal in one place: it DOES descend
		// each legacy macro's own `commands`, and an unreadable one there is skipped
		// and flagged complete. Widening the guard was tried and is inert -
		// `removeMacroIndirection` runs later in the same launch, rehomes the macro
		// into the choice tree and deletes `settings.macros`, so the second launch
		// sees a readable `macros` and completes un-migrated anyway. Fixing it means
		// moving this migration onto the shared walk; see #1627 for the sibling
		// case.
		const treeReadable =
			!treeHasUnreadableChildren(plugin.settings.choices) &&
			!isUnreadableCommandList(settings.macros);
		if (Array.isArray(plugin.settings.choices)) {
			const choicesCopy = deepClone(plugin.settings.choices);
			plugin.settings.choices = recursiveMigrateSettingInChoices(choicesCopy);
		}

		// `settings.macros` is untrusted too, and `?? []` passes `{"0": {...}}`
		// straight through (not nullish) - which then threw `macros is not
		// iterable`, aborting and reverting the migration on every launch. Read
		// through the total accessor, and only WRITE back when the original really
		// was an array, so a malformed value survives to be recovered by hand.
		const macrosCopy = deepClone(rootMacrosOf(settings.macros));
		const macros = migrateSettingsInMacros(macrosCopy);
		
		// Save the migrated macros back to settings - later migrations still need it
		if (Array.isArray(settings.macros)) settings.macros = macros;
		
		// DO NOT delete macros here – later migrations still need it.

		if (!treeReadable) return { complete: false };
	},
};

export default mutualExclusionInsertAfterAndWriteToBottomOfFile;
