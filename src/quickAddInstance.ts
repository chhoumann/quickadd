// Dependency-light holder for the active QuickAdd plugin instance.
//
// Leaf modules (suggesters, prompts, engines, ...) frequently need the running
// plugin instance. Reading it from `main.ts` as a *value* (`QuickAdd.instance`)
// forces a value import of `main.ts` — the plugin entry point that imports the
// entire app — which pulled every one of those leaf modules into a single giant
// circular-import component. That cycle is benign for the esbuild production
// bundle but fatal for vitest's ESM evaluation order (`Class extends value
// undefined`), which is why the settings views could not be component-tested.
//
// This module imports `main.ts` for its *type* only (fully erased at build
// time), so it stays a graph leaf. main.ts publishes the instance here during
// load; everyone else reads it from here instead of from main. See #1249.
import type QuickAdd from "./main";

let instance: QuickAdd | undefined;

/** Publish the active plugin instance. Called once from `QuickAdd.onload`. */
export function setQuickAddInstance(plugin: QuickAdd): void {
	instance = plugin;
}

/**
 * Get the active plugin instance.
 *
 * Throws if accessed before the plugin has loaded — every caller runs while the
 * plugin is active (a GUI is open, a macro is running, ...), so an unset value
 * is a programming error rather than an expected state.
 */
export function getQuickAddInstance(): QuickAdd {
	if (!instance) {
		throw new Error(
			"QuickAdd plugin instance accessed before it was initialised.",
		);
	}
	return instance;
}
