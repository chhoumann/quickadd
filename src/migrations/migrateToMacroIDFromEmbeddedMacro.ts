import QuickAdd from "src/main";
import { ChoiceType } from "src/types/choices/choiceType";
import IChoice from "src/types/choices/IChoice";
import IMacroChoice from "src/types/choices/IMacroChoice";
import IMultiChoice from "src/types/choices/IMultiChoice";

export default {
	description: "Migrate to macro ID from embedded macro in macro choices.",
	migrate: async (plugin: QuickAdd) => {
		// Did not make sense to have copies of macros in the choices when they are maintained for themselves.
		// Instead we reference by id now. Have to port this over for all users.
		function convertMacroChoiceMacroToIdHelper(choice: IChoice): IChoice {
			if (choice.type === ChoiceType.Multi) {
				let multiChoice = choice as IMultiChoice;
				const multiChoices = multiChoice.choices.map(
					convertMacroChoiceMacroToIdHelper
				);
				multiChoice = { ...multiChoice, choices: multiChoices };
				return multiChoice;
			}

			if (choice.type !== ChoiceType.Macro) return choice;
			const macroChoice = choice as IMacroChoice;

			if (macroChoice.macro) {
				macroChoice.macroId = macroChoice.macro.id;
				delete macroChoice.macro;
			}

			return macroChoice;
		}

		plugin.settings.choices = plugin.settings.choices.map(
			convertMacroChoiceMacroToIdHelper
		);

		await plugin.saveSettings();
	},
};
