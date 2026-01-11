import { log } from "../logger/logManager";
import type QuickAdd from "../main";
import type { Migration } from "./Migrations";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type IChoice from "../types/choices/IChoice";
import { walkAllChoices } from "./helpers/choice-traversal";
import {
	coerceLegacyOpenFileInNewTab,
	createFileOpeningFromLegacy,
} from "./helpers/file-opening-legacy";


const migrateFileOpeningSettings: Migration = {
	description: "Migrate legacy openFileInNewTab settings to new fileOpening format",
	migrate: async (plugin: QuickAdd) => {
		log.logMessage("Starting migration of file opening settings...");
		
		let migratedCount = 0;
		
		// Migration visitor function
		const migrateFileOpening = (choice: IChoice) => {
			if (choice.type !== "Template" && choice.type !== "Capture") return;

			const templateOrCaptureChoice = choice as ITemplateChoice | ICaptureChoice;
			
			// Only migrate if new fileOpening doesn't exist but legacy settings do
			const legacyTabRaw = (templateOrCaptureChoice as any).openFileInNewTab;
			const legacyMode = (templateOrCaptureChoice as any).openFileInMode;
			const legacyTab = coerceLegacyOpenFileInNewTab(legacyTabRaw);
			
			if (!templateOrCaptureChoice.fileOpening && legacyTabRaw) {
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
		
		// Save the updated settings
		await plugin.saveSettings();
	},
};

export default migrateFileOpeningSettings;
