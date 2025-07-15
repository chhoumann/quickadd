import type IChoice from "src/types/choices/IChoice";
import type { IMacro } from "src/types/macros/IMacro";
import { isCaptureChoice } from "./helpers/isCaptureChoice";
import { isMultiChoice } from "./helpers/isMultiChoice";
import { isNestedChoiceCommand } from "./helpers/isNestedChoiceCommand";
import type { Migration } from "./Migrations";

function recursiveMigrateSettingInChoices(choices: IChoice[]): IChoice[] {
	for (const choice of choices) {
		if (isMultiChoice(choice)) {
			choice.choices = recursiveMigrateSettingInChoices(choice.choices);
		}

		if (isCaptureChoice(choice)) {
			if (choice.insertAfter.enabled && choice.prepend) {
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
					command.choice.insertAfter.enabled &&
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
	 
	migrate: async (plugin) => {
		const choicesCopy = structuredClone(plugin.settings.choices);
		const choices = recursiveMigrateSettingInChoices(choicesCopy);

		const macrosCopy = structuredClone((plugin.settings as any).macros || []);
		const macros = migrateSettingsInMacros(macrosCopy);

		plugin.settings.choices = choices;
		
		// Save the migrated macros back to settings - later migrations still need it
		(plugin.settings as any).macros = macros;
		
		/* DO NOT delete macros here – later migrations still need it
		// Clean up legacy macros array if it exists
		if ('macros' in plugin.settings) {
			delete (plugin.settings as any).macros;
		}
		*/
	},
};

export default mutualExclusionInsertAfterAndWriteToBottomOfFile;
