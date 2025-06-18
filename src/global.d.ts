import type { Plugin } from "obsidian";

declare module "obsidian" {
	interface App {
		plugins: {
			plugins: {
				[pluginId: string]: Plugin & {
					[pluginImplementations: string]: unknown;
				};
			};
			enablePlugin: (id: string) => Promise<void>;
			disablePlugin: (id: string) => Promise<void>;
		};
		internalPlugins: {
			plugins: {
				[pluginId: string]: Plugin & {
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
		}
	}
}
