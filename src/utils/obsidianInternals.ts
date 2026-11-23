import type { App, Command, MarkdownView, SettingPage, SettingTab } from "obsidian";

// Obsidian APIs QuickAdd relies on that the public typings do not declare.
// Every read of them goes through this module, so the shapes QuickAdd depends
// on are written down once, and each one is optional: an Obsidian release that
// moves an internal makes its helper report "unavailable" instead of throwing.

/** Obsidian's settings window (`app.setting`). */
export interface AppSetting {
	open?: () => void;
	openTabById?: (id: string) => void;
	/** The path Obsidian's settings search takes to a result on a sub-page (1.13). */
	navigateToSearchResult?: (
		target: { tab: SettingTab; pagePath: string[] },
		match: null,
	) => void;
	/** What Obsidian calls when the user opens a page entry (1.13). */
	openPage?: (page: SettingPage) => void;
	updatePageTitle?: () => void;
}

/** A core plugin (`app.internalPlugins.plugins[id]`). */
export interface InternalPlugin {
	enabled?: boolean;
	instance?: unknown;
}

export interface MetadataTypeManager {
	getTypeInfo?: (key: string) => unknown;
	getAllProperties?: () => unknown;
}

interface InternalApp {
	commands?: {
		commands?: Record<string, Command>;
		executeCommandById?: (commandId: string) => boolean;
	};
	plugins?: {
		plugins?: Record<string, unknown>;
		enablePlugin?: (id: string) => Promise<unknown>;
		disablePlugin?: (id: string) => Promise<unknown>;
	};
	internalPlugins?: { plugins?: Record<string, InternalPlugin | undefined> };
	setting?: AppSetting;
	metadataTypeManager?: MetadataTypeManager;
	metadataCache?: {
		getTags?: () => Record<string, number>;
		app?: { metadataTypeManager?: MetadataTypeManager };
	};
	vault?: { getConfig?: (key: string) => unknown };
}

function internals(app: App | undefined): InternalApp | undefined {
	return app as InternalApp | undefined;
}

/** Every registered command palette command, by id. */
export function getObsidianCommands(app: App): Record<string, Command> | undefined {
	return internals(app)?.commands?.commands;
}

/** Runs a command palette command. False when it did not run. */
export function executeObsidianCommand(app: App, commandId: string): boolean {
	return internals(app)?.commands?.executeCommandById?.(commandId) === true;
}

/** Every tag in the vault (with its `#`) and how many times it is used. */
export function getMetadataCacheTags(app: App): Record<string, number> | undefined {
	return internals(app)?.metadataCache?.getTags?.();
}

export function getAppSetting(app: App): AppSetting | undefined {
	return internals(app)?.setting;
}

/** The manager behind Obsidian's property types, on App or (older builds) on metadataCache.app. */
export function getMetadataTypeManager(app: App): MetadataTypeManager | undefined {
	const internal = internals(app);
	return internal?.metadataTypeManager ?? internal?.metadataCache?.app?.metadataTypeManager;
}

export function getInternalPlugin(app: App | undefined, id: string): InternalPlugin | undefined {
	return internals(app)?.internalPlugins?.plugins?.[id];
}

/** A community plugin's instance. Its shape is the plugin's own business, so callers check what they read. */
export function getCommunityPlugin(app: App | undefined, id: string): unknown {
	return internals(app)?.plugins?.plugins?.[id];
}

/** Turns a community plugin off and on again, which reloads its code. */
export async function reloadCommunityPlugin(app: App, id: string): Promise<void> {
	const plugins = internals(app)?.plugins;
	await plugins?.disablePlugin?.(id);
	await plugins?.enablePlugin?.(id);
}

/** Whether a view's earlier `save()` is still writing. */
export function isMarkdownViewSaving(view: MarkdownView): boolean {
	return (view as { saving?: boolean }).saving === true;
}

/** One of Obsidian's own settings, e.g. `useMarkdownLinks` or `newFileLocation`. */
export function getVaultConfig(app: App, key: string): unknown {
	return internals(app)?.vault?.getConfig?.(key);
}
