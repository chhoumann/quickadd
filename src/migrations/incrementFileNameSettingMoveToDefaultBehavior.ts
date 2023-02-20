import QuickAdd from "src/main";
import IChoice from "src/types/choices/IChoice";
import { MultiChoice } from "src/types/choices/MultiChoice";
import { TemplateChoice } from "src/types/choices/TemplateChoice";
import { NestedChoiceCommand } from "src/types/macros/QuickCommands/NestedChoiceCommand";
import { IMacro } from "src/types/macros/IMacro";
import { Migration } from "./Migrations";
import { ChoiceType } from "src/types/choices/choiceType";

type OldTemplateChoice = TemplateChoice & { incrementFileName?: boolean };

function isOldTemplateChoice(
	choice: any
): choice is OldTemplateChoice {
    for (const key in choice) {
        if (key === "incrementFileName") {
            return true;
        }
    }

    return false;
}

function isMultiChoice(
    choice: any
): choice is MultiChoice {
    return choice.type === ChoiceType.Multi && choice.choices !== undefined;
}

function recursiveRemoveIncrementFileName(
    choices: IChoice[]
): IChoice[] {
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

function isNestedChoiceCommand(
    command: any
): command is NestedChoiceCommand {
    return command.choice !== undefined;
}

function removeIncrementFileName(
    macros: IMacro[]
): IMacro[] {
    for (const macro of macros) {
        for (const command of macro.commands) {
            if (isNestedChoiceCommand(command) && isOldTemplateChoice(command.choice)) {
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
	migrate: async (plugin: QuickAdd): Promise<boolean> => {
        const choicesCopy = structuredClone(plugin.settings.choices);
        const choices = recursiveRemoveIncrementFileName(choicesCopy);

        const macrosCopy = structuredClone(plugin.settings.macros);
        const macros = removeIncrementFileName(macrosCopy);

        plugin.settings.choices = structuredClone(choices);
        plugin.settings.macros = structuredClone(macros);

		return true;
	},
};

export default incrementFileNameSettingMoveToDefaultBehavior;
