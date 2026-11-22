import type { MigrationContext } from "../types/pluginContext";
import type { QuickAddSettings } from "../settings";
import { deepClone } from "src/utils/deepClone";
import { isTemplateChoice } from "src/types/choices/choiceGuards";
import { normalizeTemplateChoice } from "./helpers/normalizeTemplateFileExistsBehavior";
import {
	settingsTreeHasUnreadableData,
	walkChoicesInSettings,
} from "src/utils/choiceTraversal";
import type { Migration, MigrationResult } from "./Migrations";
import type { IMacro } from "src/types/macros/IMacro";

type SettingsWithLegacyMacros = QuickAddSettings & { macros?: IMacro[] };

const consolidateFileExistsBehavior: Migration = {
	description:
		"Re-run template file collision normalization for users with older migration state",

	migrate: async (plugin: MigrationContext): Promise<MigrationResult | void> => {
		const settings = plugin.settings as SettingsWithLegacyMacros;
		// Never rewrite a corrupt root with [], and stay pending while the walk
		// cannot see every choice, so a vault repaired by hand still migrates.
		const treeReadable = !settingsTreeHasUnreadableData(settings);
		if (Array.isArray(plugin.settings.choices)) {
			plugin.settings.choices = deepClone(plugin.settings.choices);
		}
		if (Array.isArray(settings.macros)) {
			settings.macros = deepClone(settings.macros);
		}

		walkChoicesInSettings(plugin.settings, (choice) => {
			if (isTemplateChoice(choice)) {
				normalizeTemplateChoice(choice);
			}
		});

		if (!treeReadable) return { complete: false };
	},
};

export default consolidateFileExistsBehavior;
