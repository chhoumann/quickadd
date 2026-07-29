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

		// Both halves of this migration MOVE data: they translate the legacy
		// `openFileInNewTab` / `openFileInMode` keys into `fileOpening`, and nothing
		// at runtime reads the legacy keys. A choice hidden behind a container this
		// walk could not read would therefore lose its "open in new tab" preference
		// permanently once the migration is flagged complete, even after the user
		// repairs data.json. Stay pending instead (#1610).
		//
		// A MISSING `fileOpening`, by contrast, needs no guard at all: the engines
		// call `normalizeFileOpening(this.choice.fileOpening)` on every run, so the
		// defaults half is fully compensated at runtime.
		//
		// This migration does NOT call saveSettings() itself: migrate.ts re-syncs the
		// store and saves once after the whole run. A per-migration write would be a
		// full data.json rewrite, and once this can stay PENDING that is one on every
		// launch, straight into Obsidian Sync's whole-file last-write-wins.
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
				// Ensure legacy fields have defaults
				const tabSettings = {
					enabled: legacyTab?.enabled ?? false,
					direction: legacyTab?.direction ?? "vertical",
					focus: legacyTab?.focus ?? true,
				};
				
				// Create new fileOpening settings from legacy ones
				templateOrCaptureChoice.fileOpening = createFileOpeningFromLegacy(
					tabSettings,
					legacyMode ?? "default"
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
