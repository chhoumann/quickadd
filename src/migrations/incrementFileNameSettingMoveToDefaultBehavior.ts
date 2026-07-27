import type QuickAdd from "src/main";
import type IChoice from "src/types/choices/IChoice";
import type { IMacro } from "src/types/macros/IMacro";
import { deepClone } from "src/utils/deepClone";
import { isMultiChoice } from "./helpers/isMultiChoice";
import { isNestedChoiceCommand } from "./helpers/isNestedChoiceCommand";
import type { Migration, MigrationResult } from "./Migrations";
import { treeHasUnreadableChildren } from "src/utils/choiceUtils";
import { isUnreadableCommandList, rootMacrosOf } from "src/utils/macroUtils";

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
		// This migration recurses `Multi.choices` itself (and legacy macros
		// separately), so it asks the FOLDERS-ONLY question - blocking it on a
		// `macro.commands` it never descends would strand it for nothing (#1610).
		const treeReadable =
			!treeHasUnreadableChildren(plugin.settings.choices) &&
			!isUnreadableCommandList(settings.macros);
		if (Array.isArray(plugin.settings.choices)) {
			const choicesCopy = deepClone(plugin.settings.choices);
			plugin.settings.choices = deepClone(
				recursiveRemoveIncrementFileName(choicesCopy),
			);
		}

		// `settings.macros` is untrusted too, and `?? []` passes `{"0": {...}}`
		// straight through (not nullish) - which then threw `macros is not
		// iterable`, aborting and reverting the migration on every launch. Read
		// through the total accessor, and only WRITE back when the original really
		// was an array, so a malformed value survives to be recovered by hand.
		const macrosCopy = deepClone(rootMacrosOf(settings.macros));
		const macros = removeIncrementFileName(macrosCopy);
		
		// Save the migrated macros back to settings - later migrations still need it
		if (Array.isArray(settings.macros)) settings.macros = macros;
		
		// DO NOT delete macros here – later migrations still need it.

		if (!treeReadable) return { complete: false };
	},
};

export default incrementFileNameSettingMoveToDefaultBehavior;
