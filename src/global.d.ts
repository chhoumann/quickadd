import { App as OApp, Plugin } from "obsidian";

declare module "obsidian" {
	interface App {
		plugins: {
			plugins: {
				[pluginId: string]: Plugin & {
					[pluginImplementations: string]: any;
				};
			};
			enablePlugin: (id: string) => Promise<void>;
			disablePlugin: (id: string) => Promise<void>;
		};
		internalPlugins: {
			plugins: {
				[pluginId: string]: Plugin & {
					[pluginImplementations: string]: any;
				};
			};
			enablePlugin: (id: string) => Promise<void>;
			disablePlugin: (id: string) => Promise<void>;
		};
	}
}
