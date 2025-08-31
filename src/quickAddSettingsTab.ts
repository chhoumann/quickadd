import type { App , TAbstractFile } from "obsidian";
import { PluginSettingTab, Setting, TFolder } from "obsidian";
import type QuickAdd from "./main";
import type IChoice from "./types/choices/IChoice";
import ChoiceView from "./gui/choiceList/ChoiceView.svelte";
import { GenericTextSuggester } from "./gui/suggesters/genericTextSuggester";
import { settingsStore } from "./settingsStore";
import type { Model } from "./ai/Provider";
import { DefaultProviders, type AIProvider } from "./ai/Provider";

export interface QuickAddSettings {
	choices: IChoice[];
	inputPrompt: "multi-line" | "single-line";
	devMode: boolean;
	templateFolderPath: string;
	announceUpdates: boolean;
	version: string;
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
	autoRenameDestinationFolders: boolean;
	showAutoRenameNotifications: boolean;
	autoRenameTemplateFiles: boolean;
	autoRenameUserScripts: boolean;
	autoRenameFormatReferences: boolean;
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
	};
}

export const DEFAULT_SETTINGS: QuickAddSettings = {
	choices: [],
	inputPrompt: "single-line",
	devMode: false,
	templateFolderPath: "",
	announceUpdates: true,
	version: "0.0.0",
	onePageInputEnabled: false,
	disableOnlineFeatures: true,
	enableRibbonIcon: false,
	showCaptureNotification: true,
	autoRenameDestinationFolders: true,
	showAutoRenameNotifications: true,
	autoRenameTemplateFiles: true,
	autoRenameUserScripts: true,
	autoRenameFormatReferences: true,
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
	},
};

export class QuickAddSettingsTab extends PluginSettingTab {
	public plugin: QuickAdd;
	private choiceView: ChoiceView;
	private autoRenameNotificationSetting: Setting;

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
		this.addAnnounceUpdatesSetting();
		this.addShowCaptureNotificationSetting();
		this.addAutoRenameFoldersSetting();
		this.addOnePageInputSetting();
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

	addShowCaptureNotificationSetting() {
		const setting = new Setting(this.containerEl);
		setting.setName("Show Capture Notifications");
		setting.setDesc(
			"Display a notification when content is captured successfully to confirm the operation completed."
		);
		setting.addToggle((toggle) => {
			toggle.setValue(settingsStore.getState().showCaptureNotification);
			toggle.onChange((value) => {
				settingsStore.setState({ showCaptureNotification: value });
			});
		});
	}

	addAutoRenameFoldersSetting() {
		const setting = new Setting(this.containerEl);
		setting.setName("Auto-rename destination folders");
		setting.setDesc(
			"Automatically update QuickAdd choices when folders they reference are renamed in the vault."
		);
		setting.addToggle((toggle) => {
			toggle.setValue(settingsStore.getState().autoRenameDestinationFolders);
			toggle.onChange((value) => {
				settingsStore.setState({ autoRenameDestinationFolders: value });
				// Update notification setting visibility
				this.updateAutoRenameNotificationSetting();
			});
		});

		// Add notification sub-setting
		this.addAutoRenameNotificationSetting(setting);
	}

	private addAutoRenameNotificationSetting(parentSetting: Setting) {
		const subSetting = new Setting(this.containerEl);
		subSetting.setClass("quickadd-sub-setting");
		subSetting.settingEl.style.marginLeft = "30px";
		subSetting.setName("Show auto-rename notifications");
		subSetting.setDesc(
			"Display a notification when folders are automatically updated in choices."
		);
		
		const toggle = subSetting.addToggle((toggle) => {
			toggle.setValue(settingsStore.getState().showAutoRenameNotifications);
			toggle.onChange((value) => {
				settingsStore.setState({ showAutoRenameNotifications: value });
			});
		});

		// Store reference for updating visibility
		this.autoRenameNotificationSetting = subSetting;
		this.updateAutoRenameNotificationSetting();
	}

	private updateAutoRenameNotificationSetting() {
		if (this.autoRenameNotificationSetting) {
			const isEnabled = settingsStore.getState().autoRenameDestinationFolders;
			this.autoRenameNotificationSetting.settingEl.style.display = isEnabled ? "" : "none";
		}
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

	private addOnePageInputSetting() {
		new Setting(this.containerEl)
			.setName("One-page input for choices (Beta)")
			.setDesc(
				"Experimental. Resolve variables up front and show a single dynamic form before executing Template/Capture choices. See Advanced → One-page Inputs in docs."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(settingsStore.getState().onePageInputEnabled)
					.onChange((value) => {
						settingsStore.setState({ onePageInputEnabled: value });
					})
			);
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
