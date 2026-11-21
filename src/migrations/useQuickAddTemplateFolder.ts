import { log } from "src/logger/logManager";
import type { MigrationContext } from "../types/pluginContext";
import { normalizeTemplateFolderPaths } from "src/utils/templateFolderUtils";
import { getCommunityPlugin, getInternalPlugin } from "src/utils/obsidianInternals";
import { isRecord } from "src/utils/isRecord";

function stringField(source: unknown, key: string): string | undefined {
	const value = isRecord(source) ? source[key] : undefined;
	return typeof value === "string" && value ? value : undefined;
}

export default {
	description:
		"Use QuickAdd template folder instead of Obsidian templates plugin folder / Templater templates folder.",

	migrate: async (plugin: MigrationContext): Promise<void> => {
		const templaterPlugin = getCommunityPlugin(plugin.app, "templater");
		const obsidianTemplatesPlugin = getInternalPlugin(plugin.app, "templates");

		if (!templaterPlugin && !obsidianTemplatesPlugin) {
			log.logMessage("No template plugin found. Skipping migration.");

			return;
		}

		// Collect a folder from each source. QuickAdd now supports multiple
		// template folders, so keep both rather than letting one overwrite the
		// other; normalizeTemplateFolderPaths de-duplicates if they coincide.
		const folders: string[] = [];

		const obsidianTemplatesInstance = obsidianTemplatesPlugin?.instance;
		const obsidianTemplatesFolder = stringField(
			isRecord(obsidianTemplatesInstance) ? obsidianTemplatesInstance.options : undefined,
			"folder",
		);
		if (obsidianTemplatesFolder) {
			folders.push(obsidianTemplatesFolder);
			log.logMessage("Migrated template folder path to Obsidian Templates' setting.");
		}

		const templaterFolder = stringField(
			isRecord(templaterPlugin) ? templaterPlugin.settings : undefined,
			"template_folder",
		);
		if (templaterFolder) {
			folders.push(templaterFolder);
			log.logMessage("Migrated template folder path to Templaters setting.");
		}

		// Merge with any already-configured folders rather than replacing them,
		// so this can't clobber values set by another migration regardless of
		// run order; normalizeTemplateFolderPaths de-duplicates.
		const existing = normalizeTemplateFolderPaths(
			plugin.settings.templateFolderPaths,
		);
		const normalizedFolders = normalizeTemplateFolderPaths([
			...existing,
			...folders,
		]);
		if (normalizedFolders.length > 0) {
			plugin.settings.templateFolderPaths = normalizedFolders;
		}
	},
};
