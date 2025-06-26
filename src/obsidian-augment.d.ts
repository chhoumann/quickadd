import "obsidian";

declare module "obsidian" {
	interface Plugin {
		/**
		 * Register an interval so Obsidian automatically clears it when the plugin unloads.
		 * Returns the interval id for convenience.
		 */
		registerInterval(id: number): number;
	}
}