import type { Plugin as ObsidianPlugin } from "obsidian";

declare module "obsidian" {
	interface App {
		plugins: {
			plugins: {
				[pluginId: string]: ObsidianPlugin & {
					[pluginImplementations: string]: unknown;
				};
			};
			enablePlugin: (id: string) => Promise<void>;
			disablePlugin: (id: string) => Promise<void>;
		};
		internalPlugins: {
			plugins: {
				[pluginId: string]: ObsidianPlugin & {
					[pluginImplementations: string]: unknown;
				};
			};
			enablePlugin: (id: string) => Promise<void>;
			disablePlugin: (id: string) => Promise<void>;
		};
		commands: {
			commands: {
				[commandName: string]: (...args: unknown[]) => Promise<void>;
			},
			editorCommands: {
				[commandName: string]: (...args: unknown[]) => Promise<void>;
			},
			findCommand: (commandId: string) => Command;
		};
	}

	interface Modal {
		/**
		 * Obsidian's handler for Esc in the modal's scope (not in the public API).
		 * It closes the modal unless the event's default is already prevented.
		 * Obsidian runs it from a window capture listener, before any listener on
		 * an input inside the modal.
		 */
		onEscapeKey(evt: KeyboardEvent): void;
	}
}

// Obsidian installs its DOM factory globals in each workspace window.
declare global {
	interface Window {
		createEl: typeof createEl;
		createDiv: typeof createDiv;
		createSpan: typeof createSpan;
		createFragment: typeof createFragment;
	}
}
