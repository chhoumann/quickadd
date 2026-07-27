import type IChoice from "src/types/choices/IChoice";
import type { IMacro } from "src/types/macros/IMacro";
import { isCaptureChoice } from "./helpers/isCaptureChoice";
import { isMultiChoice } from "./helpers/isMultiChoice";
import { isNestedChoiceCommand } from "./helpers/isNestedChoiceCommand";
import type { Migration, MigrationResult } from "./Migrations";
import { deepClone } from "src/utils/deepClone";
import type QuickAdd from "src/main";
import { treeHasUnreadableChildren } from "src/utils/choiceUtils";

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
	for (const macro of macros) {
		if (!Array.isArray(macro.commands)) continue;

		for (const command of macro.commands) {
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
		const treeReadable = !treeHasUnreadableChildren(plugin.settings.choices);
		if (Array.isArray(plugin.settings.choices)) {
			const choicesCopy = deepClone(plugin.settings.choices);
			plugin.settings.choices = recursiveMigrateSettingInChoices(choicesCopy);
		}

		const macrosCopy = deepClone(settings.macros ?? []);
		const macros = migrateSettingsInMacros(macrosCopy);
		
		// Save the migrated macros back to settings - later migrations still need it
		settings.macros = macros;
		
		// DO NOT delete macros here – later migrations still need it.

		if (!treeReadable) return { complete: false };
	},
};

export default mutualExclusionInsertAfterAndWriteToBottomOfFile;
