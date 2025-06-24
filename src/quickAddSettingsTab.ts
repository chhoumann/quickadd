import type { App , TAbstractFile } from "obsidian";
import { PluginSettingTab, Setting, TFolder } from "obsidian";
import type QuickAdd from "./main";
import type IChoice from "./types/choices/IChoice";
import ChoiceView from "./gui/choiceList/ChoiceView.svelte";
import type { IMacro } from "./types/macros/IMacro";
import { GenericTextSuggester } from "./gui/suggesters/genericTextSuggester";
import { settingsStore } from "./settingsStore";
import type { Model } from "./ai/Provider";
import { DefaultProviders, type AIProvider } from "./ai/Provider";

export interface QuickAddSettings {
	choices: IChoice[];
	macros: IMacro[];
	inputPrompt: "multi-line" | "single-line";
	devMode: boolean;
	templateFolderPath: string;
	announceUpdates: boolean;
	version: string;
	/**
	 * If this is true, then the plugin is not to contact external services (e.g. OpenAI, etc.) via plugin features.
	 * Users _can_ still use User Scripts to do so by executing arbitrary JavaScript, but that is not something the plugin controls.
	 */
	disableOnlineFeatures: boolean;
	enableRibbonIcon: boolean;
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
	};
	searchRanking: {
		mode: "classic" | "balanced" | "contextual";
		contextualBoostMultiplier: number;
	};
}

export const DEFAULT_SETTINGS: QuickAddSettings = {
	choices: [],
	macros: [],
	inputPrompt: "single-line",
	devMode: false,
	templateFolderPath: "",
	announceUpdates: true,
	version: "0.0.0",
	disableOnlineFeatures: true,
	enableRibbonIcon: false,
	ai: {
		defaultModel: "Ask me",
		defaultSystemPrompt: `As an AI assistant within Obsidian, your primary goal is to help users manage their ideas and knowledge more effectively. Format your responses using Markdown syntax. Please use the [[Obsidian]] link format. You can write aliases for the links by writing [[Obsidian|the alias after the pipe symbol]]. To use mathematical notation, use LaTeX syntax. LaTeX syntax for larger equations should be on separate lines, surrounded with double dollar signs ($$). You can also inline math expressions by wrapping it in $ symbols. For example, use $$w_{ij}^{\text{new}}:=w_{ij}^{\text{current}}+\eta\cdot\delta_j\cdot x_{ij}$$ on a separate line, but you can write "($\eta$ = learning rate, $\delta_j$ = error term, $x_{ij}$ = input)" inline.`,
		promptTemplatesFolderPath: "",
		showAssistant: true,
		providers: DefaultProviders,
	},
	migrations: {
		migrateToMacroIDFromEmbeddedMacro: false,
		useQuickAddTemplateFolder: false,
		incrementFileNameSettingMoveToDefaultBehavior: false,
		mutualExclusionInsertAfterAndWriteToBottomOfFile: false,
		setVersionAfterUpdateModalRelease: false,
		addDefaultAIProviders: false,
	},
	searchRanking: {
		mode: "balanced",
		contextualBoostMultiplier: 1.0,
	},
};

export class QuickAddSettingsTab extends PluginSettingTab {
	public plugin: QuickAdd;
	private choiceView: ChoiceView;

	constructor(app: App, plugin: QuickAdd) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "QuickAdd Settings" });

		this.addChoicesSetting();
		this.addUseMultiLineInputPromptSetting();
		this.addTemplateFolderPathSetting();
		this.addSearchRankingSettings();
		this.addAnnounceUpdatesSetting();
		this.addDisableOnlineFeaturesSetting();
		this.addEnableRibbonIconSetting();
	}

	addAnnounceUpdatesSetting() {
		const setting = new Setting(this.containerEl);
		setting.setName("Announce Updates");
		setting.setDesc(
			"Display release notes when a new version is installed. This includes new features, demo videos, and bug fixes."
		);
		setting.addToggle((toggle) => {
			toggle.setValue(settingsStore.getState().announceUpdates);
			toggle.onChange((value) => {
				settingsStore.setState({ announceUpdates: value });
			});
		});
	}

	hide(): void {
		if (this.choiceView) this.choiceView.$destroy();
	}

	private addChoicesSetting(): void {
		const setting = new Setting(this.containerEl);
		setting.infoEl.remove();
		setting.settingEl.style.display = "block";

		this.choiceView = new ChoiceView({
			target: setting.settingEl,
			props: {
				app: this.app,
				plugin: this.plugin,
				choices: settingsStore.getState().choices,
				saveChoices: (choices: IChoice[]) => {
					settingsStore.setState({ choices });
				},
				macros: settingsStore.getState().macros,
				saveMacros: (macros: IMacro[]) => {
					settingsStore.setState({ macros });
				},
			},
		});
	}

	private addUseMultiLineInputPromptSetting() {
		new Setting(this.containerEl)
			.setName("Use Multi-line Input Prompt")
			.setDesc(
				"Use multi-line input prompt instead of single-line input prompt"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.inputPrompt === "multi-line")
					.setTooltip("Use multi-line input prompt")
					.onChange((value) => {
						if (value) {
							settingsStore.setState({
								inputPrompt: "multi-line",
							});
						} else {
							settingsStore.setState({
								inputPrompt: "single-line",
							});
						}
					})
			);
	}

	private addSearchRankingSettings() {
		const setting = new Setting(this.containerEl);
		setting.setName("Search Ranking Mode");
		setting.setDesc(
			"Control how file suggestions are ranked. Classic: alphabetical order. Balanced: smart ranking with moderate context. Contextual: maximum relevance using folder, recency, and tags."
		);
		
		setting.addDropdown((dropdown) => {
			dropdown
				.addOption("classic", "Classic (Alphabetical)")
				.addOption("balanced", "Balanced (Default)")
				.addOption("contextual", "Contextual (Smart)")
				.setValue(settingsStore.getState().searchRanking?.mode || "balanced")
				.onChange((value: "classic" | "balanced" | "contextual") => {
					const currentSettings = settingsStore.getState();
					settingsStore.setState({
						...currentSettings,
						searchRanking: {
							...currentSettings.searchRanking,
							mode: value,
							contextualBoostMultiplier: value === "classic" ? 0 : value === "contextual" ? 1.5 : 1.0,
						},
					});
				});
		});

		// Advanced contextual boost slider
		const contextualSetting = new Setting(this.containerEl);
		contextualSetting.setName("Contextual Boost Strength");
		contextualSetting.setDesc(
			"Fine-tune how much context (folder, recency, tags) affects ranking. 0 = no context, 1 = normal, 2 = double strength."
		);
		
		contextualSetting.addSlider((slider) => {
			const currentMultiplier = settingsStore.getState().searchRanking?.contextualBoostMultiplier ?? 1.0;
			slider
				.setLimits(0, 2, 0.1)
				.setValue(currentMultiplier)
				.setDynamicTooltip()
				.onChange((value) => {
					const currentSettings = settingsStore.getState();
					settingsStore.setState({
						...currentSettings,
						searchRanking: {
							...currentSettings.searchRanking,
							contextualBoostMultiplier: value,
						},
					});
				});
		});
	}

	private addTemplateFolderPathSetting() {
		const setting = new Setting(this.containerEl);

		setting.setName("Template Folder Path");
		setting.setDesc(
			"Path to the folder where templates are stored. Used to suggest template files when configuring QuickAdd."
		);

		setting.addText((text) => {
			text.setPlaceholder("templates/")
				.setValue(settingsStore.getState().templateFolderPath)
				.onChange((value) => {
					settingsStore.setState({ templateFolderPath: value });
				});

			new GenericTextSuggester(
				this.app,
				text.inputEl,
				this.app.vault
					.getAllLoadedFiles()
					.filter((f: TAbstractFile) => f instanceof TFolder && f.path !== "/")
					.map((f: TAbstractFile) => f.path)
			);
		});
	}

	private addDisableOnlineFeaturesSetting() {
		new Setting(this.containerEl)
			.setName("Disable AI & Online features")
			.setDesc(
				"This prevents the plugin from making requests to external providers like OpenAI. You can still use User Scripts to execute arbitrary code, including contacting external providers. However, this setting disables plugin features like the AI Assistant from doing so. You need to disable this setting to use the AI Assistant."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(settingsStore.getState().disableOnlineFeatures)
					.onChange((value) => {
						settingsStore.setState({
							disableOnlineFeatures: value,
						});

						this.display();
					})
			);
	}
	
	private addEnableRibbonIconSetting() {
		new Setting(this.containerEl)
			.setName("Show icon in sidebar")
			.setDesc("Add QuickAdd icon to the sidebar ribbon. Requires a reload.")
			.addToggle((toggle) => {
				toggle
					.setValue(settingsStore.getState().enableRibbonIcon)
					.onChange((value:boolean) => {
						settingsStore.setState({
							enableRibbonIcon: value,
						});

						this.display();
					})
			});
	}
}
