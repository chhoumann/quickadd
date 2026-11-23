// Holder for the active QuickAdd plugin instance, for the few leaf modules
// (suggesters, prompts) that are built without one being handed to them.
//
// Reading the instance from `main.ts` would import the plugin entry point,
// which imports the entire app, into every one of those modules.
// This module only names the capabilities they use, so it stays a graph leaf.
// main.ts publishes the instance here during load and clears it on unload.
import type { Plugin } from "obsidian";
import type { ChoiceRuntimePlugin } from "./types/pluginContext";

export type QuickAddInstance = Plugin & ChoiceRuntimePlugin;

let instance: QuickAddInstance | undefined;

/** Publish the active plugin instance, or clear it. Set in `QuickAdd.onload`, cleared in `onunload`. */
export function setQuickAddInstance(plugin: QuickAddInstance | undefined): void {
	instance = plugin;
}

/**
 * Get the active plugin instance.
 *
 * Throws while the plugin is not loaded - every caller runs while the plugin
 * is active (a GUI is open, a macro is running, ...), so an unset value is a
 * programming error rather than an expected state.
 */
export function getQuickAddInstance(): QuickAddInstance {
	if (!instance) {
		throw new Error(
			"QuickAdd plugin instance accessed while QuickAdd is not loaded.",
		);
	}
	return instance;
}
