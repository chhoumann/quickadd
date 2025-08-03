import { log } from "../logger/logManager";
import type QuickAdd from "../main";
import type { Migration } from "./Migrations";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type IChoice from "../types/choices/IChoice";
import type { MultiChoice } from "../types/choices/MultiChoice";
import type { FileViewMode2 } from "../types/fileOpening";

/**
 * Create fileOpening settings from legacy values (migration only)
 */
function createFileOpeningFromLegacy(
	oldTab: { enabled: boolean; direction: string; focus: boolean },
	oldMode: string
): {
	location: "split" | "tab";
	direction: "vertical" | "horizontal";
	mode: FileViewMode2;
	focus: boolean;
} {
	return {
		location: oldTab.enabled ? "split" : "tab",
		direction: oldTab.direction === "horizontal" ? "horizontal" : "vertical",
		focus: oldTab.focus ?? true,
		mode: oldMode === "default" ? "default" : oldMode as FileViewMode2,
	};
}

/**
 * Recursively walk through all choices, including nested Multi choices
 */
function walkChoice(choice: IChoice, visitor: (c: IChoice) => void) {
	visitor(choice);
	if (choice.type === "Multi") {
		const multiChoice = choice as MultiChoice;
		for (const child of multiChoice.choices) {
			walkChoice(child, visitor);
		}
	}
}

/**
 * Check if a macro command contains a nested choice
 */
function isNestedChoiceCommand(command: any): boolean {
	return command && command.choice && typeof command.choice === "object";
}

/**
 * Apply visitor to all choices in the system (root choices + macro embedded choices)
 */
function migrateAllChoices(plugin: QuickAdd, visitor: (c: IChoice) => void) {
	// 1. Walk root-level choices and nested Multi choices
	for (const choice of plugin.settings.choices) {
		walkChoice(choice, visitor);
	}

	// 2. Walk choices embedded in macros
	const macros = (plugin.settings as any).macros ?? [];
	for (const macro of macros) {
		if (!Array.isArray(macro.commands)) continue;
		for (const command of macro.commands) {
			if (isNestedChoiceCommand(command)) {
				walkChoice(command.choice, visitor);
			}
		}
	}
}

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
			const legacyTab = (templateOrCaptureChoice as any).openFileInNewTab;
			const legacyMode = (templateOrCaptureChoice as any).openFileInMode;
			
			if (!templateOrCaptureChoice.fileOpening && legacyTab) {
				// Ensure legacy fields have defaults
				const tabSettings = {
					enabled: legacyTab.enabled ?? false,
					direction: legacyTab.direction ?? "vertical",
					focus: legacyTab.focus ?? true,
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
		migrateAllChoices(plugin, migrateFileOpening);
		
		log.logMessage(`Migration complete. Migrated ${migratedCount} choices.`);
		
		// Save the updated settings
		await plugin.saveSettings();
	},
};

export default migrateFileOpeningSettings;
