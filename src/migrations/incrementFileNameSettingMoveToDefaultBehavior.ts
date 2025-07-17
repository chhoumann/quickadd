import type QuickAdd from "src/main";
import type IChoice from "src/types/choices/IChoice";
import type { IMacro } from "src/types/macros/IMacro";
import { isMultiChoice } from "./helpers/isMultiChoice";
import { isNestedChoiceCommand } from "./helpers/isNestedChoiceCommand";
import { isOldTemplateChoice } from "./helpers/isOldTemplateChoice";
import type { Migration } from "./Migrations";

function recursiveRemoveIncrementFileName(choices: IChoice[]): IChoice[] {
	for (const choice of choices) {
		if (isMultiChoice(choice)) {
			choice.choices = recursiveRemoveIncrementFileName(choice.choices);
		}

		if (isOldTemplateChoice(choice)) {
			choice.setFileExistsBehavior = true;
			choice.fileExistsMode = "Increment the file name";

			delete choice.incrementFileName;
		}
	}

	return choices;
}

function removeIncrementFileName(macros: IMacro[]): IMacro[] {
	for (const macro of macros) {
		if (!Array.isArray(macro.commands)) continue;

		for (const command of macro.commands) {
			if (
				isNestedChoiceCommand(command) &&
				isOldTemplateChoice(command.choice)
			) {
				command.choice.setFileExistsBehavior = true;
				command.choice.fileExistsMode = "Increment the file name";

				delete command.choice.incrementFileName;
			}
		}
	}

	return macros;
}

const incrementFileNameSettingMoveToDefaultBehavior: Migration = {
	description:
		"'Increment file name' setting moved to 'Set default behavior if file already exists' setting",
	 
	migrate: async (plugin: QuickAdd): Promise<void> => {
		const choicesCopy = structuredClone(plugin.settings.choices);
		const choices = recursiveRemoveIncrementFileName(choicesCopy);

		const macrosCopy = structuredClone((plugin.settings as any).macros || []);
		const macros = removeIncrementFileName(macrosCopy);

		plugin.settings.choices = structuredClone(choices);
		
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

export default incrementFileNameSettingMoveToDefaultBehavior;
