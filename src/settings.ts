import type { Model } from "./ai/Provider";
import { DefaultProviders, type AIProvider } from "./ai/Provider";
import type IChoice from "./types/choices/IChoice";
import { DEFAULT_DATE_ALIASES } from "./utils/dateAliases";

export interface QuickAddSettings {
	choices: IChoice[];
	inputPrompt: "multi-line" | "single-line";
	persistInputPromptDrafts: boolean;
	/**
		* When enabled, Capture uses the current editor selection as the default {{VALUE}}.
		*/
	useSelectionAsCaptureValue: boolean;
	devMode: boolean;
	templateFolderPath: string;
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
	enableRibbonIcon: boolean;
	showCaptureNotification: boolean;
	showInputCancellationNotification: boolean;
	enableTemplatePropertyTypes: boolean;
	dateAliases: Record<string, string>;
	ai: {
		defaultModel: Model["name"] | "Ask me";
		defaultSystemPrompt: string;
		promptTemplatesFolderPath: string;
		showAssistant: boolean;
		providers: AIProvider[];
	};
	migrations: {
		migrateToMacroIDFromEmbeddedMacro: boolean;
		useQuickAddTemplateFolder: boolean;
		incrementFileNameSettingMoveToDefaultBehavior: boolean;
		mutualExclusionInsertAfterAndWriteToBottomOfFile: boolean;
		setVersionAfterUpdateModalRelease: boolean;
		addDefaultAIProviders: boolean;
		removeMacroIndirection: boolean;
		migrateFileOpeningSettings: boolean;
		backfillFileOpeningDefaults: boolean;
		setProviderModelDiscoveryMode: boolean;
		migrateProviderApiKeysToSecretStorage: boolean;
	};
}

export const DEFAULT_SETTINGS: QuickAddSettings = {
	choices: [],
	inputPrompt: "single-line",
	persistInputPromptDrafts: true,
	useSelectionAsCaptureValue: true,
	devMode: false,
	templateFolderPath: "",
	announceUpdates: "major",
	version: "0.0.0",
	globalVariables: {},
	onePageInputEnabled: false,
	disableOnlineFeatures: true,
	enableRibbonIcon: false,
	showCaptureNotification: true,
	showInputCancellationNotification: false,
	enableTemplatePropertyTypes: false,
	dateAliases: DEFAULT_DATE_ALIASES,
	ai: {
		defaultModel: "Ask me",
		defaultSystemPrompt: `As an AI assistant within Obsidian, your primary goal is to help users manage their ideas and knowledge more effectively. Format your responses using Markdown syntax. Please use the [[Obsidian]] link format. You can write aliases for the links by writing [[Obsidian|the alias after the pipe symbol]]. To use mathematical notation, use LaTeX syntax. LaTeX syntax for larger equations should be on separate lines, surrounded with double dollar signs ($$). You can also inline math expressions by wrapping it in $ symbols. For example, use $$w_{ij}^{\text{new}}:=w_{ij}^{\text{current}}+\eta\cdot\delta_j\cdot x_{ij}$$ on a separate line, but you can write "($\eta$ = learning rate, $\delta_j$ = error term, $x_{ij}$ = input)" inline.`,
		promptTemplatesFolderPath: "",
		showAssistant: true,
		providers: DefaultProviders,
	},
	migrations: {
		/**
			* @deprecated kept for backward compatibility; always true, ignored.
			*/
		migrateToMacroIDFromEmbeddedMacro: true,
		useQuickAddTemplateFolder: false,
		incrementFileNameSettingMoveToDefaultBehavior: false,
		mutualExclusionInsertAfterAndWriteToBottomOfFile: false,
		setVersionAfterUpdateModalRelease: false,
		addDefaultAIProviders: false,
		removeMacroIndirection: false,
		migrateFileOpeningSettings: false,
		backfillFileOpeningDefaults: false,
		setProviderModelDiscoveryMode: false,
		migrateProviderApiKeysToSecretStorage: false,
	},
};
