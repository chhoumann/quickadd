import { log } from "../logger/logManager";
import type QuickAdd from "../main";
import type { Migration, MigrationResult } from "./Migrations";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type IChoice from "../types/choices/IChoice";
import {
	settingsTreeHasUnreadableData,
	walkAllChoices,
} from "./helpers/choice-traversal";
import {
	coerceLegacyOpenFileInNewTab,
	createFileOpeningFromLegacy,
} from "./helpers/file-opening-legacy";

type LegacyFileOpeningChoice = (ITemplateChoice | ICaptureChoice) & {
	openFileInNewTab?: unknown;
	openFileInMode?: unknown;
};

const migrateFileOpeningSettings: Migration = {
	description: "Migrate legacy openFileInNewTab settings to new fileOpening format",
	migrate: async (plugin: QuickAdd): Promise<MigrationResult | void> => {
		log.logMessage("Starting migration of file opening settings...");

		// Legacy fields are not read at runtime, so skipped subtrees must retry.
		// The migration runner saves once after the complete batch.
		const unreadable = settingsTreeHasUnreadableData(plugin.settings);

		let migratedCount = 0;

		// Migration visitor function
		const migrateFileOpening = (choice: IChoice) => {
			if (choice.type !== "Template" && choice.type !== "Capture") return;

			const templateOrCaptureChoice = choice as LegacyFileOpeningChoice;

			// Only migrate if new fileOpening doesn't exist but legacy settings do
			const legacyTabRaw = templateOrCaptureChoice.openFileInNewTab;
			const legacyMode = templateOrCaptureChoice.openFileInMode;
			const legacyTab = coerceLegacyOpenFileInNewTab(legacyTabRaw);

			if (!templateOrCaptureChoice.fileOpening && legacyTab) {
				templateOrCaptureChoice.fileOpening = createFileOpeningFromLegacy(
					legacyTab,
					legacyMode,
				);

				migratedCount++;
				log.logMessage(`Migrated file opening settings for choice: ${choice.name}`);
			}
		};

		// Apply migration to all choices recursively
		walkAllChoices(plugin, migrateFileOpening);

		log.logMessage(`Migration complete. Migrated ${migratedCount} choices.`);

		if (unreadable) return { complete: false };
	},
};

export default migrateFileOpeningSettings;
