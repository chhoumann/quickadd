import type QuickAdd from "src/main";
import type IChoice from "src/types/choices/IChoice";
import type { IMacro } from "src/types/macros/IMacro";
import { deepClone } from "src/utils/deepClone";
import {
	isTemplateChoice,
	normalizeTemplateChoice,
} from "./helpers/normalizeTemplateFileExistsBehavior";
import { isMultiChoice } from "./helpers/isMultiChoice";
import { isNestedChoiceCommand } from "./helpers/isNestedChoiceCommand";
import type { Migration } from "./Migrations";

function normalizeChoices(choices: IChoice[]): IChoice[] {
	for (const choice of choices) {
		if (isMultiChoice(choice)) {
			choice.choices = normalizeChoices(choice.choices);
		}

		if (isTemplateChoice(choice)) {
			normalizeTemplateChoice(choice);
		}
	}

	return choices;
}

function normalizeMacros(macros: IMacro[]): IMacro[] {
	for (const macro of macros) {
		if (!Array.isArray(macro.commands)) continue;

		for (const command of macro.commands) {
			if (isNestedChoiceCommand(command) && isTemplateChoice(command.choice)) {
				normalizeTemplateChoice(command.choice);
			}
		}
	}

	return macros;
}

const consolidateFileExistsBehavior: Migration = {
	description:
		"Re-run template file collision normalization for users with older migration state",

	migrate: async (plugin: QuickAdd): Promise<void> => {
		const choicesCopy = deepClone(plugin.settings.choices);
		const macrosCopy = deepClone((plugin.settings as any).macros || []);

		plugin.settings.choices = deepClone(normalizeChoices(choicesCopy));
		(plugin.settings as any).macros = normalizeMacros(macrosCopy);
	},
};

export default consolidateFileExistsBehavior;
