import type QuickAdd from "src/main";
import type IChoice from "src/types/choices/IChoice";
import type { IMacro } from "src/types/macros/IMacro";
import { deepClone } from "src/utils/deepClone";
import {
	mapLegacyFileExistsModeToId,
	type TemplateFileExistsBehavior,
} from "../template/fileExistsPolicy";
import { isMultiChoice } from "./helpers/isMultiChoice";
import { isNestedChoiceCommand } from "./helpers/isNestedChoiceCommand";
import type { Migration } from "./Migrations";

type LegacyTemplateChoice = {
	type?: string;
	incrementFileName?: boolean;
	setFileExistsBehavior?: boolean;
	fileExistsMode?: unknown;
	fileExistsBehavior?: TemplateFileExistsBehavior;
};

function isTemplateChoice(choice: unknown): choice is LegacyTemplateChoice {
	return (
		typeof choice === "object" &&
		choice !== null &&
		"type" in choice &&
		(choice as { type?: string }).type === "Template"
	);
}

function migrateFileExistsBehavior(
	choice: LegacyTemplateChoice,
): TemplateFileExistsBehavior {
	if (choice.fileExistsBehavior) {
		return choice.fileExistsBehavior;
	}

	if (choice.incrementFileName) {
		return { kind: "apply", mode: "increment" };
	}

	if (choice.setFileExistsBehavior) {
		return {
			kind: "apply",
			mode: mapLegacyFileExistsModeToId(choice.fileExistsMode) ?? "increment",
		};
	}

	return { kind: "prompt" };
}

function normalizeTemplateChoice(choice: LegacyTemplateChoice): void {
	choice.fileExistsBehavior = migrateFileExistsBehavior(choice);
	delete choice.incrementFileName;
	delete choice.setFileExistsBehavior;
	delete choice.fileExistsMode;
}

function recursiveRemoveIncrementFileName(choices: IChoice[]): IChoice[] {
	for (const choice of choices) {
		if (isMultiChoice(choice)) {
			choice.choices = recursiveRemoveIncrementFileName(choice.choices);
		}

		if (isTemplateChoice(choice)) {
			normalizeTemplateChoice(choice);
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
				isTemplateChoice(command.choice)
			) {
				normalizeTemplateChoice(command.choice);
			}
		}
	}

	return macros;
}

const incrementFileNameSettingMoveToDefaultBehavior: Migration = {
	description:
		"Template file collision settings consolidated into a single behavior model",
	 
	migrate: async (plugin: QuickAdd): Promise<void> => {
		const choicesCopy = deepClone(plugin.settings.choices);
		const choices = recursiveRemoveIncrementFileName(choicesCopy);

		const macrosCopy = deepClone((plugin.settings as any).macros || []);
		const macros = removeIncrementFileName(macrosCopy);

		plugin.settings.choices = deepClone(choices);
		
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
