import IChoice from "src/types/choices/IChoice";
import { IMacro } from "src/types/macros/IMacro";
import { isCaptureChoice } from "./isCaptureChoice";
import { isMultiChoice } from "./isMultiChoice";
import { isNestedChoiceCommand } from "./isNestedChoiceCommand";
import { Migration } from "./Migrations";

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

		const macrosCopy = structuredClone(plugin.settings.macros);
		const macros = migrateSettingsInMacros(macrosCopy);

		plugin.settings.choices = choices;
		plugin.settings.macros = macros;
	},
};

export default mutualExclusionInsertAfterAndWriteToBottomOfFile;
