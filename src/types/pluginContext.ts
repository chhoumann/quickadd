import type { App, TFile } from "obsidian";
import type { QuickAddSettings } from "../settings";
import type IChoice from "./choices/IChoice";

// The plugin capabilities the rest of QuickAdd depends on. The QuickAdd class
// in main.ts satisfies each of them structurally, so a module asks for the
// narrowest one it uses instead of importing the plugin class. That keeps
// main.ts out of every module's dependencies and lets tests pass small fakes.

export interface AppProvider {
	readonly app: App;
}

export interface SettingsProvider {
	readonly settings: QuickAddSettings;
}

export interface SettingsSaver {
	saveSettings(): Promise<void>;
}

export interface ChoiceLookup {
	/** Throws when no choice has this id. */
	getChoiceById(id: string): IChoice;
	/** Throws when no choice has this name. Names are not unique; the first match wins. */
	getChoiceByName(name: string): IChoice;
	findChoiceById(id: string): IChoice | null;
	findChoiceByName(name: string): IChoice | null;
}

/** Keeps the command palette in step with the choices that have a command. */
export interface ChoiceCommandRegistrar {
	addCommandForChoice(choice: IChoice): void;
	/**
	 * `recursive` also removes the commands of a folder's descendants, for when
	 * the whole subtree is going away.
	 */
	removeCommandForChoice(
		choice: IChoice,
		options?: { recursive?: boolean },
	): void;
}

export interface TemplateFileSource {
	/** The template files QuickAdd can resolve, limited to the template folders when any are set. */
	getTemplateFiles(): TFile[];
}

export interface PluginManifestInfo {
	readonly manifest: { readonly id: string; readonly version: string };
}

/** What a settings migration may read and replace. */
export interface MigrationContext extends AppProvider, SettingsSaver, PluginManifestInfo {
	settings: QuickAddSettings;
}

/** What the formatters and their previews read from the plugin. */
export type FormatterPluginContext = SettingsProvider;

/**
 * What running a choice needs from the plugin: the engines, the script API
 * they hand to user scripts (which can import packages and run other choices),
 * and the one-page form.
 */
export interface ChoiceRuntimePlugin
	extends AppProvider,
		SettingsProvider,
		SettingsSaver,
		ChoiceLookup,
		ChoiceCommandRegistrar,
		TemplateFileSource,
		PluginManifestInfo {}

/** What the choice builders and their format fields read from the plugin. */
export type ChoiceBuilderPlugin = SettingsProvider & TemplateFileSource;
