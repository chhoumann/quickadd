import "obsidian";
import type { App, PluginManifest } from "obsidian";

declare module "obsidian" {
	interface Plugin {
		/**
		 * Register an interval so Obsidian automatically clears it when the plugin unloads.
		 * Returns the interval id for convenience.
		 */
		registerInterval(id: number): number;
		/** Expose the running Obsidian application instance */
		readonly app: App;
		/** Plugin manifest injected by Obsidian */
		readonly manifest: PluginManifest;
		addCommand(command: unknown): string;
	}
}