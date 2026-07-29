import type QuickAdd from "src/main";
import { deepClone } from "src/utils/deepClone";
import {
	isTemplateChoice,
	normalizeTemplateChoice,
} from "./helpers/normalizeTemplateFileExistsBehavior";
import {
	settingsTreeHasUnreadableData,
	walkAllChoices,
} from "./helpers/choice-traversal";
import type { Migration, MigrationResult } from "./Migrations";
import type { IMacro } from "src/types/macros/IMacro";

type SettingsWithLegacyMacros = QuickAdd["settings"] & { macros?: IMacro[] };

const consolidateFileExistsBehavior: Migration = {
	description:
		"Re-run template file collision normalization for users with older migration state",

	migrate: async (plugin: QuickAdd): Promise<MigrationResult | void> => {
		const settings = plugin.settings as SettingsWithLegacyMacros;
		// Only re-clone a real array. Substituting [] for a corrupt root would
		// persist that [] on the next save and destroy whatever is still in
		// data.json, which is the opposite of what a migration should do (#1566).
		// When it is unreadable the walk below covers nothing, so stay pending and
		// re-run once the user has repaired the file.
		// This migration walks with `walkAllChoices`, so it must ask the WIDE
		// question - a nested choice hidden behind an unreadable `macro.commands`
		// is one this visitor would have normalized (#1610).
		const treeReadable = !settingsTreeHasUnreadableData(settings);
		if (Array.isArray(plugin.settings.choices)) {
			plugin.settings.choices = deepClone(plugin.settings.choices);
		}
		if (Array.isArray(settings.macros)) {
			settings.macros = deepClone(settings.macros);
		}

		walkAllChoices(plugin, (choice) => {
			if (isTemplateChoice(choice)) {
				normalizeTemplateChoice(choice);
			}
		});

		if (!treeReadable) return { complete: false };
	},
};

export default consolidateFileExistsBehavior;
