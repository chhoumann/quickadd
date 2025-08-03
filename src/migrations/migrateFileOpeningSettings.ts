import { log } from "../logger/logManager";
import type QuickAdd from "../main";
import type { Migration } from "./Migrations";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import { NewTabDirection } from "../types/newTabDirection";
import { getInitialFileOpening } from "../utilityObsidian";

const migrateFileOpeningSettings: Migration = {
	description: "Migrate legacy openFileInNewTab settings to new fileOpening format",
	migrate: async (plugin: QuickAdd) => {
		log.logMessage("Starting migration of file opening settings...");
		
		let migratedCount = 0;
		
		// Migrate all Template and Capture choices
		for (const choice of plugin.settings.choices) {
			if (choice.type === "Template" || choice.type === "Capture") {
				const templateOrCaptureChoice = choice as ITemplateChoice | ICaptureChoice;
				
				// Only migrate if new fileOpening doesn't exist but legacy settings do
				if (!templateOrCaptureChoice.fileOpening && templateOrCaptureChoice.openFileInNewTab) {
					// Ensure openFileInNewTab has all required fields
					if (!templateOrCaptureChoice.openFileInNewTab.direction) {
						templateOrCaptureChoice.openFileInNewTab.direction = NewTabDirection.vertical;
					}
					if (templateOrCaptureChoice.openFileInNewTab.focus === undefined) {
						templateOrCaptureChoice.openFileInNewTab.focus = true;
					}
					
					// Create new fileOpening settings from legacy ones
					templateOrCaptureChoice.fileOpening = getInitialFileOpening(
						templateOrCaptureChoice.openFileInNewTab,
						templateOrCaptureChoice.openFileInMode
					);
					
					migratedCount++;
					log.logMessage(`Migrated file opening settings for choice: ${choice.name}`);
				}
			}
		}
		
		log.logMessage(`Migration complete. Migrated ${migratedCount} choices.`);
		
		// Save the updated settings
		await plugin.saveSettings();
	},
};

export default migrateFileOpeningSettings;
