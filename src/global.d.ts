import type { Plugin as ObsidianPlugin } from "obsidian";

declare module "obsidian" {
	interface Workspace {
		/**
		 * Undocumented mobile event (#632): fired when text is shared into Obsidian,
		 * letting plugins add items to the in-app "share to" menu before it is shown.
		 * Absent from the public obsidian.d.ts — the public `Events.on(name: string, …)`
		 * catch-all already typechecks the call, so this overload is a DX nicety that
		 * types the `(menu, text)` arguments. Verified emitted by the current Obsidian
		 * bundle (`workspace.trigger("receive-text-menu", menu, text)`) and used in
		 * production by ReadItLater.
		 */
		on(
			name: "receive-text-menu",
			callback: (menu: Menu, text: string) => unknown,
			ctx?: unknown,
		): EventRef;
	}

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
}
