import type { IMacro } from "src/types/macros/IMacro";
import { isCaptureChoice } from "src/types/choices/choiceGuards";
import type { Migration, MigrationResult } from "./Migrations";
import { deepClone } from "src/utils/deepClone";
import type { QuickAddSettings } from "../settings";
import {
	settingsTreeHasUnreadableData,
	walkChoicesInSettings,
} from "src/utils/choiceTraversal";

type SettingsWithLegacyMacros = QuickAddSettings & { macros?: IMacro[] };

const mutualExclusionInsertAfterAndWriteToBottomOfFile: Migration = {
	description:
		"Mutual exclusion of insertAfter and writeToBottomOfFile settings. If insertAfter is enabled, writeToBottomOfFile is disabled. To support changes in settings UI.",

	migrate: async (plugin): Promise<MigrationResult | void> => {
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
			// `insertAfter` may be absent on legacy/imported/hand-edited choices;
			// treat a missing object as not-enabled instead of throwing.
			if (isCaptureChoice(choice) && choice.insertAfter?.enabled && choice.prepend) {
				choice.prepend = false;
			}
		});

		if (!treeReadable) return { complete: false };
	},
};

export default mutualExclusionInsertAfterAndWriteToBottomOfFile;
