import type { Model, ModelRef } from "./ai/Provider";
import { DefaultProviders, type AIProvider } from "./ai/Provider";
import type IChoice from "./types/choices/IChoice";
import type { ActionNode } from "./v3/model";
import { DEFAULT_DATE_ALIASES } from "./utils/dateAliases";

/** Position of the "New note from template" row in the Run QuickAdd launcher. */
export type TemplateFolderLauncherRowPosition = "off" | "top" | "bottom";

export interface QuickAddSettings {
	/**
	 * In memory only: what `actions` lower to, which the builder edits. Saving
	 * folds the edits back into `actions` (src/v3/storage.ts).
	 */
	choices: IChoice[];
	/**
	 * The QuickAdd 3 actions as data.json stores them, absent until the
	 * choices were migrated. They own what no choice can hold, such as
	 * `show.ribbon`.
	 */
	actions?: ActionNode[];
	inputPrompt: "multi-line" | "single-line";
	persistInputPromptDrafts: boolean;
	/**
		 * When enabled, Capture uses the current editor selection as the default {{VALUE}}.
		 */
	useSelectionAsCaptureValue: boolean;
	/**
		 * Name clipboard images (prompt paste and {{CLIPBOARD}} image fallback)
		 * after the destination note when that path is known. Unknown destination
		 * keeps the timestamp name. Collisions use Obsidian's attachment-folder API.
		 */
	namePastedImagesAfterNoteTitle: boolean;
	/**
		* When enabled, typing in the choice picker also searches choices nested
		* inside Multi choices and shows matches with their folder path.
		*/
	searchNestedChoices: boolean;
	/**
		* Where the "New note from template" row appears in Run QuickAdd (when at
		* least one template folder is configured). `"bottom"` keeps it out of the
		* first-Enter slot; `"top"` makes it the first item; `"off"` hides it (the
		* command palette entry always works regardless).
		*/
	templateFolderLauncherRow: TemplateFolderLauncherRowPosition;
	devMode: boolean;
	/**
		* Folders whose files are offered as template suggestions when configuring
		* QuickAdd. An empty list suggests every template file in the vault. The
		* legacy single `templateFolderPath` is folded into this by the
		* `migrateToMultipleTemplateFolders` migration.
		*/
	templateFolderPaths: string[];
	announceUpdates: "all" | "major" | "none";
	version: string;
	globalVariables: Record<string, string>;
	/**
		* Enables the one-page input flow that pre-collects variables
		* and renders a single dynamic GUI before executing a choice.
		*/
	onePageInputEnabled: boolean;
	/**
		* If this is true, then the plugin is not to contact external services (e.g. OpenAI, etc.) via plugin features.
		* Users _can_ still use User Scripts to do so by executing arbitrary JavaScript, but that is not something the plugin controls.
		*/
	disableOnlineFeatures: boolean;
	/**
	 * When enabled, the `obsidian://quickadd` URI may open an x-callback-url
	 * (`x-success`/`x-error`/`x-cancel`) after a Template/Capture choice completes,
	 * sending the outcome and the affected note's vault path + URL to that URL.
	 * Default off because the callback URL is controlled by whoever crafts the
	 * `obsidian://` link. (Opposite default polarity to `disableOnlineFeatures`,
	 * which defaults true — both are the conservative, locked-down choice.)
	 */
	enableUriCallbacks: boolean;
	enableRibbonIcon: boolean;
	showCaptureNotification: boolean;
	showInputCancellationNotification: boolean;
	enableTemplatePropertyTypes: boolean;
	dateAliases: Record<string, string>;
	/** Whether date fields show their calendar. The calendar button in each date field toggles it. */
	showDateCalendar: boolean;
	ai: {
		// Either a configured model's name or the "Ask me" sentinel. Model["name"]
		// is `string`, which already covers the sentinel — adding `| "Ask me"` would
		// be a redundant union member that `string` subsumes.
		defaultModel: Model["name"];
		/**
		 * Provider-scoped identity of the default model. Preferred over
		 * `defaultModel` at runtime; absent for "Ask me". Writers keep
		 * `defaultModel === defaultModelRef.name`.
		 */
		defaultModelRef?: ModelRef;
		defaultSystemPrompt: string;
		promptTemplatesFolderPath: string;
		showAssistant: boolean;
		providers: AIProvider[];
		/** Epoch ms of the last background model auto-sync (throttles to daily). */
		lastModelAutoSyncAt?: number;
		/**
		 * When AI tool calling (#714) runs a script-defined or built-in tool, ask
		 * before executing. 'destructive' (default) confirms any tool not marked
		 * read-only; 'always' confirms every tool; 'never' defers to each tool's own
		 * needsApproval. A tool that requires approval is always confirmed regardless.
		 */
		confirmToolCalls: "never" | "destructive" | "always";
	};
	migrations: {
		useQuickAddTemplateFolder: boolean;
		incrementFileNameSettingMoveToDefaultBehavior: boolean;
		consolidateFileExistsBehavior: boolean;
		repairTemplateFileExistsBehavior: boolean;
		mutualExclusionInsertAfterAndWriteToBottomOfFile: boolean;
		setVersionAfterUpdateModalRelease: boolean;
		addDefaultAIProviders: boolean;
		removeMacroIndirection: boolean;
		migrateFileOpeningSettings: boolean;
		backfillFileOpeningDefaults: boolean;
		setProviderModelDiscoveryMode: boolean;
		migrateProviderApiKeysToSecretStorage: boolean;
		migrateToMultipleTemplateFolders: boolean;
		refreshStaleDefaultModelSeeds: boolean;
		pinAiModelRefs: boolean;
		migrateToV3Actions: boolean;
	};
	/** Set when the choices were migrated to QuickAdd 3 actions. */
	v3Migration?: {
		/** QuickAdd version that migrated. */
		migratedIn: string;
		/** The copy of data.json from before, next to it. Absent when there was no data.json. */
		snapshot?: string;
		/** QuickAdd version in which the migration report was closed. */
		reportDismissedIn?: string;
	};
}

export const DEFAULT_SETTINGS: QuickAddSettings = {
	choices: [],
	inputPrompt: "single-line",
	persistInputPromptDrafts: true,
	useSelectionAsCaptureValue: true,
	namePastedImagesAfterNoteTitle: false,
	searchNestedChoices: true,
	templateFolderLauncherRow: "bottom",
	devMode: false,
	templateFolderPaths: [],
	announceUpdates: "major",
	version: "0.0.0",
	globalVariables: {},
	onePageInputEnabled: false,
	disableOnlineFeatures: true,
	enableUriCallbacks: false,
	enableRibbonIcon: false,
	showCaptureNotification: true,
	showInputCancellationNotification: false,
	enableTemplatePropertyTypes: false,
	dateAliases: DEFAULT_DATE_ALIASES,
	showDateCalendar: true,
	ai: {
		defaultModel: "Ask me",
		defaultSystemPrompt: `As an AI assistant within Obsidian, your primary goal is to help users manage their ideas and knowledge more effectively. Format your responses using Markdown syntax. Please use the [[Obsidian]] link format. You can write aliases for the links by writing [[Obsidian|the alias after the pipe symbol]]. To use mathematical notation, use LaTeX syntax. LaTeX syntax for larger equations should be on separate lines, surrounded with double dollar signs ($$). You can also inline math expressions by wrapping it in $ symbols. For example, use $$w_{ij}^{\\text{new}}:=w_{ij}^{\\text{current}}+\\eta\\cdot\\delta_j\\cdot x_{ij}$$ on a separate line, but you can write "($\\eta$ = learning rate, $\\delta_j$ = error term, $x_{ij}$ = input)" inline.`,
		promptTemplatesFolderPath: "",
		showAssistant: true,
		providers: DefaultProviders,
		confirmToolCalls: "destructive",
	},
	// Older data.json files may still hold a migrateToMacroIDFromEmbeddedMacro
	// flag from a removed migration. Nothing reads it; loading keeps it as is.
	migrations: {
		useQuickAddTemplateFolder: false,
		incrementFileNameSettingMoveToDefaultBehavior: false,
		consolidateFileExistsBehavior: false,
		repairTemplateFileExistsBehavior: false,
		mutualExclusionInsertAfterAndWriteToBottomOfFile: false,
		setVersionAfterUpdateModalRelease: false,
		addDefaultAIProviders: false,
		removeMacroIndirection: false,
		migrateFileOpeningSettings: false,
		backfillFileOpeningDefaults: false,
		setProviderModelDiscoveryMode: false,
		migrateProviderApiKeysToSecretStorage: false,
		migrateToMultipleTemplateFolders: false,
		refreshStaleDefaultModelSeeds: false,
		pinAiModelRefs: false,
		migrateToV3Actions: false,
	},
};
