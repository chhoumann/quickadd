import type { Plugin } from "obsidian";
import { leaveBuilderPages, saveBuilderPages } from "../gui/ChoiceBuilder/builderPage";

/**
 * Save what QuickAdd holds only in memory before the app can lose it: an open
 * choice builder's edits, which it keeps until it is left, and the pending
 * debounced settings write. `flushPendingSave` starts that write and returns it.
 */
export function registerSaveOnExit(
	plugin: Plugin,
	flushPendingSave: () => Promise<void>,
): void {
	// Quitting closes the window without closing settings or finishing the
	// debounced write, so a change made in the last second was lost too.
	// Obsidian waits for the tasks it is handed before it quits.
	plugin.registerEvent(
		plugin.app.workspace.on("quit", (tasks) => {
			leaveBuilderPages(plugin.app);
			tasks.addPromise(flushPendingSave());
		}),
	);

	// A phone can kill the app once it is in the background, with no event
	// first. Save in place: the user comes back to the same page.
	const saveInPlace = () => {
		saveBuilderPages(plugin.app);
		void flushPendingSave();
	};
	plugin.registerDomEvent(document, "visibilitychange", () => {
		if (document.visibilityState === "hidden") saveInPlace();
	});
	// Opening the iOS app switcher makes the app inactive without hiding the
	// page, and the app can be force-quit from there. Obsidian reports that as
	// a blur of the window (and saves its own open notes then). A field's blur
	// does not bubble here.
	plugin.registerDomEvent(window, "blur", saveInPlace);
}
