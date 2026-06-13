import type QuickAdd from "src/main";
import { normalizeTemplateFolderPaths } from "src/utilityObsidian";

/**
 * Fold the legacy single `templateFolderPath` string into the multi-folder
 * `templateFolderPaths` list (issue #1170). Stores the canonical (normalized)
 * form so the data model is clean at rest, not just at read time. Idempotent
 * and safe on fresh installs: a missing/blank legacy value just leaves an empty
 * list. The dead key is dropped afterwards so it does not linger in data.json.
 */
export default {
	description:
		"Move the single template folder path into the multi-folder list.",
	migrate: async (plugin: QuickAdd): Promise<void> => {
		const settings = plugin.settings as typeof plugin.settings & {
			templateFolderPath?: unknown;
		};

		// Gate on the normalized list, not the raw array length: a corrupt or
		// whitespace-only array must not shadow a valid legacy value.
		const existing = normalizeTemplateFolderPaths(settings.templateFolderPaths);
		if (existing.length > 0) {
			settings.templateFolderPaths = existing;
		} else {
			settings.templateFolderPaths = normalizeTemplateFolderPaths([
				settings.templateFolderPath,
			]);
		}

		delete settings.templateFolderPath;
	},
};
