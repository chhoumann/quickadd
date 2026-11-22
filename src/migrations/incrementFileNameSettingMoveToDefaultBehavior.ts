import type { MigrationContext } from "../types/pluginContext";
import type { QuickAddSettings } from "../settings";
import type IChoice from "src/types/choices/IChoice";
import type { IMacro } from "src/types/macros/IMacro";
import { deepClone } from "src/utils/deepClone";
import {
	settingsTreeHasUnreadableData,
	walkChoicesInSettings,
} from "src/utils/choiceTraversal";
import type { Migration, MigrationResult } from "./Migrations";

type OldTemplateChoice = {
	type?: string;
	incrementFileName?: boolean;
	setFileExistsBehavior?: boolean;
	fileExistsMode?: unknown;
};
type SettingsWithLegacyMacros = QuickAddSettings & { macros?: IMacro[] };

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

const incrementFileNameSettingMoveToDefaultBehavior: Migration = {
	description:
		"'Increment file name' setting moved to 'Set default behavior if file already exists' setting",

	migrate: async (plugin: MigrationContext): Promise<MigrationResult | void> => {
		const settings = plugin.settings as SettingsWithLegacyMacros;

		// Never rewrite a corrupt root with [], and stay pending while the walk
		// cannot see every choice, so a vault repaired by hand still migrates.
		const treeReadable = !settingsTreeHasUnreadableData(settings);
		if (Array.isArray(plugin.settings.choices)) {
			plugin.settings.choices = deepClone(plugin.settings.choices);
		}
		// Later migrations still read `settings.macros`; keep it, migrated.
		if (Array.isArray(settings.macros)) {
			settings.macros = deepClone(settings.macros);
		}

		walkChoicesInSettings(settings, (choice) => {
			if (!isOldTemplateChoice(choice)) return;
			choice.setFileExistsBehavior = true;
			choice.fileExistsMode = "Increment the file name";
			delete choice.incrementFileName;
		});

		if (!treeReadable) return { complete: false };
	},
};

export default incrementFileNameSettingMoveToDefaultBehavior;
