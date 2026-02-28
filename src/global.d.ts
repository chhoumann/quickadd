import type {
	BaseComponent,
	IconName,
	Plugin as ObsidianPlugin,
} from "obsidian";

declare module "obsidian" {
	interface CliData {
		[key: string]: string | "true";
	}

	interface CliFlag {
		value?: string;
		description: string;
		required?: boolean;
	}

	type CliFlags = Record<string, CliFlag>;
	type CliHandler = (params: CliData) => string | Promise<string>;

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

	interface Setting {
		addComponent<T extends BaseComponent>(cb: (el: HTMLElement) => T): this;
	}

	export class SettingGroup {
		constructor(containerEl: HTMLElement);
		setHeading(text: string | DocumentFragment): this;
		addClass(cls: string): this;
		addSetting(cb: (setting: Setting) => void): this;
	}

	interface SettingTab {
		icon: IconName;
	}

	interface Plugin {
		registerCliHandler?: (
			command: string,
			description: string,
			flags: CliFlags | null,
			handler: CliHandler,
		) => void;
	}
}
