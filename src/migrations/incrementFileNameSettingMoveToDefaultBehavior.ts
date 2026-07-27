import type QuickAdd from "src/main";
import type IChoice from "src/types/choices/IChoice";
import type { IMacro } from "src/types/macros/IMacro";
import { deepClone } from "src/utils/deepClone";
import { isMultiChoice } from "./helpers/isMultiChoice";
import { isNestedChoiceCommand } from "./helpers/isNestedChoiceCommand";
import type { Migration, MigrationResult } from "./Migrations";

type OldTemplateChoice = {
	type?: string;
	incrementFileName?: boolean;
	setFileExistsBehavior?: boolean;
	fileExistsMode?: unknown;
};
type SettingsWithLegacyMacros = QuickAdd["settings"] & { macros?: IMacro[] };

function isOldTemplateChoice(
	choice: unknown,
): choice is IChoice & OldTemplateChoice {
	return (
		typeof choice === "object" &&
		choice !== null &&
		"type" in choice &&
		(choice as { type?: string }).type === "Template" &&
		"incrementFileName" in choice
	);
}

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
	 
	migrate: async (plugin: QuickAdd): Promise<MigrationResult | void> => {
		const settings = plugin.settings as SettingsWithLegacyMacros;

		// See the sibling migrations (#1566): never rewrite a corrupt root with [],
		// and stay PENDING when the choices half could not run, so a vault repaired
		// by hand is still migrated.
		const rootReadable = Array.isArray(plugin.settings.choices);
		if (rootReadable) {
			const choicesCopy = deepClone(plugin.settings.choices);
			plugin.settings.choices = deepClone(
				recursiveRemoveIncrementFileName(choicesCopy),
			);
		}

		const macrosCopy = deepClone(settings.macros ?? []);
		const macros = removeIncrementFileName(macrosCopy);
		
		// Save the migrated macros back to settings - later migrations still need it
		settings.macros = macros;
		
		// DO NOT delete macros here – later migrations still need it.

		if (!rootReadable) return { complete: false };
	},
};

export default incrementFileNameSettingMoveToDefaultBehavior;
