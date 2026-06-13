import { log } from "src/logger/logManager";
import type QuickAdd from "src/main";
import { normalizeTemplateFolderPaths } from "src/utilityObsidian";

export default {
	description:
		"Use QuickAdd template folder instead of Obsidian templates plugin folder / Templater templates folder.",

	migrate: async (plugin: QuickAdd): Promise<void> => {
		try {
			const templaterPlugin = plugin.app.plugins.plugins["templater"];
			const obsidianTemplatesPlugin =
				plugin.app.internalPlugins.plugins["templates"];

			if (!templaterPlugin && !obsidianTemplatesPlugin) {
				log.logMessage("No template plugin found. Skipping migration.");

				return;
			}

			// Collect a folder from each source. QuickAdd now supports multiple
			// template folders, so keep both rather than letting one overwrite the
			// other; normalizeTemplateFolderPaths de-duplicates if they coincide.
			const folders: string[] = [];

			if (obsidianTemplatesPlugin) {

				const obsidianTemplatesSettings =
					//@ts-ignore
					obsidianTemplatesPlugin.instance.options;

				if (obsidianTemplatesSettings["folder"]) {
					folders.push(obsidianTemplatesSettings["folder"]);

					log.logMessage(
						"Migrated template folder path to Obsidian Templates' setting."
					);
				}
			}

			if (templaterPlugin) {
				const templaterSettings = templaterPlugin.settings;
					//@ts-ignore
				if (templaterSettings["template_folder"]) {
					folders.push(
						//@ts-ignore
						templaterSettings["template_folder"],
					);

					log.logMessage(
						"Migrated template folder path to Templaters setting."
					);
				}
			}

			const normalizedFolders = normalizeTemplateFolderPaths(folders);
			if (normalizedFolders.length > 0) {
				plugin.settings.templateFolderPaths = normalizedFolders;
			}
		} catch (error) {
			log.logError("Failed to migrate template folder path.");

			throw error;
		}
	},
};
