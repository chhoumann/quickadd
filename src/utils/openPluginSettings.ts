import type { App, SettingPage, SettingTab } from "obsidian";
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

/** Closes the settings window, so a note opened from it is in view. */
export function closeSettings(app: App): void {
	(app as unknown as { setting?: { close?: () => void } }).setting?.close?.();
}

/**
 * Opens a sub-page of a settings tab, e.g. Settings → QuickAdd → AI Assistant.
 * Obsidian has no public API for this; `navigateToSearchResult` is the
 * internal path its own settings search takes to a result on a sub-page
 * (Obsidian 1.13). Returns false when that is unavailable or throws.
 */
export function tryOpenSettingsPage(
	app: App,
	tab: SettingTab,
	pagePath: string[],
): boolean {
	try {
		const setting = (
			app as unknown as {
				setting?: {
					navigateToSearchResult?: (
						target: { tab: SettingTab; pagePath: string[] },
						match: null,
					) => void;
				};
			}
		).setting;
		if (typeof setting?.navigateToSearchResult !== "function") {
			log.logMessage("QuickAdd: Obsidian's settings page navigation is unavailable.");
			return false;
		}
		setting.navigateToSearchResult({ tab, pagePath }, null);
		return true;
	} catch (error) {
		log.logMessage(`QuickAdd: Failed to open settings page: ${error}`);
		return false;
	}
}

interface SettingPageNavigation {
	openPage?: (page: SettingPage) => void;
	updatePageTitle?: () => void;
}

function settingPageNavigation(app: App): SettingPageNavigation | undefined {
	return (app as unknown as { setting?: SettingPageNavigation }).setting;
}

/**
 * Opens `page` over the settings page that is showing, with Obsidian's own
 * title bar and back navigation. Obsidian has no public API for this:
 * `openPage` is what it calls when the user opens a page entry (Obsidian
 * 1.13). Returns false when that is unavailable or throws.
 */
export function openSettingPage(app: App, page: SettingPage): boolean {
	try {
		const setting = settingPageNavigation(app);
		if (typeof setting?.openPage !== "function") {
			log.logMessage("QuickAdd: Obsidian's settings page navigation is unavailable.");
			return false;
		}
		setting.openPage(page);
		return true;
	} catch (error) {
		log.logMessage(`QuickAdd: Failed to open settings page: ${error}`);
		return false;
	}
}

/**
 * Keep an open page's titles in step with a rename: the page's title bar, and
 * the settings window's own title, which Obsidian shows as the header on
 * phones and only sets when a page opens.
 */
export function retitleSettingPage(app: App, page: SettingPage, title: string): void {
	page.title = title;
	page.titlebarEl.querySelector(".setting-page-title")?.setText(title);
	settingPageNavigation(app)?.updatePageTitle?.();
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
