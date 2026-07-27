import type QuickAdd from "src/main";
import { deepClone } from "src/utils/deepClone";
import {
	isTemplateChoice,
	normalizeTemplateChoice,
} from "./helpers/normalizeTemplateFileExistsBehavior";
import { walkAllChoices } from "./helpers/choice-traversal";
import type { Migration } from "./Migrations";
import type { IMacro } from "src/types/macros/IMacro";

type SettingsWithLegacyMacros = QuickAdd["settings"] & { macros?: IMacro[] };

const consolidateFileExistsBehavior: Migration = {
	description:
		"Re-run template file collision normalization for users with older migration state",

	migrate: async (plugin: QuickAdd): Promise<void> => {
		const settings = plugin.settings as SettingsWithLegacyMacros;
		// Only re-clone a real array. Substituting [] for a corrupt root would
		// persist that [] on the next save and destroy whatever is still in
		// data.json, which is the opposite of what a migration should do (#1566).
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
	},
};

export default consolidateFileExistsBehavior;
