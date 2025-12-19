import type { BaseComponent, IconName, Plugin, Setting } from "obsidian";

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
		};
	}

	interface Setting {
		addComponent<T extends BaseComponent>(cb: (el: HTMLElement) => T): this;
	}

	class SettingGroup {
		constructor(containerEl: HTMLElement);
		setHeading(text: string | DocumentFragment): this;
		addClass(cls: string): this;
		addSetting(cb: (setting: Setting) => void): this;
	}

	interface SettingTab {
		icon: IconName;
	}
}
