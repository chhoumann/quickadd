import type { Plugin } from "obsidian";
import { leaveBuilderPages, saveBuilderPages } from "../gui/ChoiceBuilder/builderPage";

/**
 * Save what QuickAdd holds only in memory before the app can lose it: an open
 * choice builder's edits, which it keeps until it is left, and the pending
 * debounced settings write. `flushPendingSave` starts that write and returns
 * the settings work still running, or null when there is none.
 */
export function registerSaveOnExit(
	plugin: Plugin,
	flushPendingSave: () => Promise<void> | null,
): void {
	// Quitting closes the window without closing settings or finishing the
	// debounced write, so a change made in the last second was lost too.
	// Obsidian waits for the tasks it is handed before it quits, by cancelling
	// the close, showing "Saving...", and closing again. Hand it a task only
	// when there is a write to wait for. A failed write is reported where it
	// started; handed to Obsidian, it would leave the window on "Saving...".
	plugin.registerEvent(
		plugin.app.workspace.on("quit", (tasks) => {
			leaveBuilderPages(plugin.app);
			const write = flushPendingSave();
			if (write) tasks.addPromise(write.catch(() => undefined));
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
