import { CaptureChoice } from "src/types/choices/CaptureChoice";
import { ChoiceType } from "src/types/choices/choiceType";
import IChoice from "src/types/choices/IChoice";
import { MultiChoice } from "src/types/choices/MultiChoice";
import { IMacro } from "src/types/macros/IMacro";
import { NestedChoiceCommand } from "src/types/macros/QuickCommands/NestedChoiceCommand";
import { Migration } from "./Migrations";

function isCaptureChoice(
	choice: IChoice
): choice is CaptureChoice {
    return choice.type === ChoiceType.Capture;
}

function isMultiChoice(
    choice: any
): choice is MultiChoice {
    return choice.type === ChoiceType.Multi && choice.choices !== undefined;
}

function recursiveMigrateSettingInChoices(
    choices: IChoice[]
): IChoice[] {
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

function isNestedChoiceCommand(
    command: any
): command is NestedChoiceCommand {
    return command.choice !== undefined;
}

function migrateSettingsInMacros(
    macros: IMacro[]
): IMacro[] {
    for (const macro of macros) {
        for (const command of macro.commands) {
            if (isNestedChoiceCommand(command) && isCaptureChoice(command.choice)) {
                if (command.choice.insertAfter.enabled && command.choice.prepend) {
                    command.choice.prepend = false;
                }
            }
        }
    }

    return macros;
}

const mutualExclusionInsertAfterAndWriteToBottomOfFile: Migration = {
    description: "Mutual exclusion of insertAfter and writeToBottomOfFile settings. If insertAfter is enabled, writeToBottomOfFile is disabled. To support changes in settings UI.",
    migrate: async (plugin) => {
        const choicesCopy = structuredClone(plugin.settings.choices);
        const choices = recursiveMigrateSettingInChoices(choicesCopy);

        const macrosCopy = structuredClone(plugin.settings.macros);
        const macros = migrateSettingsInMacros(macrosCopy);

        plugin.settings.choices = choices;
        plugin.settings.macros = macros;
    }
}

export default mutualExclusionInsertAfterAndWriteToBottomOfFile;