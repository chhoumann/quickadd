import type { App } from "obsidian";
import { PluginSettingTab, Setting, TFolder } from "obsidian";
import type QuickAdd from "./main";
import type IChoice from "./types/choices/IChoice";
import ChoiceView from "./gui/choiceList/ChoiceView.svelte";
import type { IMacro } from "./types/macros/IMacro";
import { GenericTextSuggester } from "./gui/suggesters/genericTextSuggester";
import { settingsStore } from "./settingsStore";

export interface QuickAddSettings {
	choices: IChoice[];
	macros: IMacro[];
	inputPrompt: "multi-line" | "single-line";
	devMode: boolean;
	templateFolderPath: string;
	announceUpdates: boolean;
	version: string;
	migrations: {
		migrateToMacroIDFromEmbeddedMacro: boolean;
		useQuickAddTemplateFolder: boolean;
		incrementFileNameSettingMoveToDefaultBehavior: boolean;
		mutualExclusionInsertAfterAndWriteToBottomOfFile: boolean;
		setVersionAfterUpdateModalRelease: boolean;
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
	migrations: {
		migrateToMacroIDFromEmbeddedMacro: false,
		useQuickAddTemplateFolder: false,
		incrementFileNameSettingMoveToDefaultBehavior: false,
		mutualExclusionInsertAfterAndWriteToBottomOfFile: false,
		setVersionAfterUpdateModalRelease: false,
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

		containerEl.createEl("h3", { text: "General Settings" });
		this.addUseMultiLineInputPromptSetting();
		this.addTemplateFolderPathSetting();
		this.addAnnounceUpdatesSetting();

		containerEl.createEl("h3", { text: "List of individual Choices (Templates, Captures, Macros)" });
		this.addChoicesSetting();
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
				app,
				text.inputEl,
				app.vault
					.getAllLoadedFiles()
					.filter((f) => f instanceof TFolder && f.path !== "/")
					.map((f) => f.path)
			);
		});
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
}
