import type { App } from "obsidian";
import { log } from "../logger/logManager";

/** Opens a plugin's settings tab. Returns false if the internal API is unavailable or throws. */
export function tryOpenPluginSettings(app: App, pluginId: string): boolean {
	try {
		const setting = (
			app as unknown as {
				setting?: { open?: () => void; openTabById?: (id: string) => void };
			}
		).setting;

		if (!setting?.open || !setting?.openTabById) {
			log.logError("QuickAdd: Obsidian internal settings API is unavailable.");
			return false;
		}

		setting.open();
		setting.openTabById(pluginId);
		return true;
	} catch (error) {
		log.logError(`QuickAdd: Failed to open plugin settings automatically: ${error}`);
		return false;
	}
}
