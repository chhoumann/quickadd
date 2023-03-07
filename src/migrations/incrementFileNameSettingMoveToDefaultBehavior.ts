import QuickAdd from "src/main";
import IChoice from "src/types/choices/IChoice";
import { IMacro } from "src/types/macros/IMacro";
import { isMultiChoice } from "./isMultiChoice";
import { isNestedChoiceCommand } from "./isNestedChoiceCommand";
import { isOldTemplateChoice } from "./isOldTemplateChoice";
import { Migration } from "./Migrations";

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

		const macrosCopy = structuredClone(plugin.settings.macros);
		const macros = removeIncrementFileName(macrosCopy);

		plugin.settings.choices = structuredClone(choices);
		plugin.settings.macros = structuredClone(macros);
	},
};

export default incrementFileNameSettingMoveToDefaultBehavior;
