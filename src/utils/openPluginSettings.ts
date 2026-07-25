import type { App } from "obsidian";
import { Notice } from "obsidian";
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
			// logMessage, not logError: GuiLogger turns every logError into a
			// 15-second Notice, and every caller of this helper already shows its own
			// (more useful) message on failure. Console diagnostics are kept.
			log.logMessage("QuickAdd: Obsidian internal settings API is unavailable.");
			return false;
		}

		setting.open();
		setting.openTabById(pluginId);
		return true;
	} catch (error) {
		log.logMessage(
			`QuickAdd: Failed to open plugin settings automatically: ${error}`,
		);
		return false;
	}
}

/**
 * Opens QuickAdd's settings tab, telling the user how to get there by hand when
 * the internal API is unavailable. Lives here rather than in `main.ts` so leaf
 * modules can reach it without value-importing the plugin entry point (the
 * import-cycle invariant from #1249).
 *
 * Pass `notice: false` when the caller has already explained itself: a second,
 * generic notice on top of a specific one is noise.
 */
export function openQuickAddSettings(
	app: App,
	pluginId: string,
	options?: { notice?: boolean },
): boolean {
	const opened = tryOpenPluginSettings(app, pluginId);
	if (!opened && options?.notice !== false) {
		new Notice(
			"QuickAdd: Unable to open settings automatically. Open Settings → QuickAdd manually.",
		);
	}
	return opened;
}
