import {
	App,
	PluginSettingTab,
	Setting,
	TFolder,
} from "obsidian";
import type QuickAdd from "./main";
import type IChoice from "./types/choices/IChoice";
import ChoiceView from "./gui/choiceList/ChoiceView.svelte";
import type { IMacro } from "./types/macros/IMacro";
import { GenericTextSuggester } from "./gui/suggesters/genericTextSuggester";

export interface QuickAddSettings {
	choices: IChoice[];
	macros: IMacro[];
	inputPrompt: "multi-line" | "single-line";
	devMode: boolean;
	templateFolderPath: string;
	migrations: {
		migrateToMacroIDFromEmbeddedMacro: boolean,
		useQuickAddTemplateFolder: boolean,
		incrementFileNameSettingMoveToDefaultBehavior: boolean;
		mutualExclusionInsertAfterAndWriteToBottomOfFile: boolean;
	}
}

export const DEFAULT_SETTINGS: QuickAddSettings = {
	choices: [],
	macros: [],
	inputPrompt: "single-line",
	devMode: false,
	templateFolderPath: "",
	migrations: {
		migrateToMacroIDFromEmbeddedMacro: false,
		useQuickAddTemplateFolder: false,
		incrementFileNameSettingMoveToDefaultBehavior: false,
		mutualExclusionInsertAfterAndWriteToBottomOfFile: false
	}
};

export class QuickAddSettingsTab extends PluginSettingTab {
	public plugin: QuickAdd;
	private choiceView: ChoiceView;

	constructor(app: App, plugin: QuickAdd) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		let { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "QuickAdd Settings" });

		this.addChoicesSetting();
		this.addUseMultiLineInputPromptSetting();
		this.addTemplateFolderPathSetting();
	}

	hide(): any {
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
				choices: this.plugin.settings.choices,
				saveChoices: async (choices: IChoice[]) => {
					this.plugin.settings.choices = choices;
					await this.plugin.saveSettings();
				},
				macros: this.plugin.settings.macros,
				saveMacros: async (macros: IMacro[]) => {
					this.plugin.settings.macros = macros;
					await this.plugin.saveSettings();
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
							this.plugin.settings.inputPrompt = "multi-line";
						} else {
							this.plugin.settings.inputPrompt = "single-line";
						}

						this.plugin.saveSettings();
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
			text.setPlaceholder(
				"templates/"
			)
				.setValue(this.plugin.settings.templateFolderPath)
				.onChange(async (value) => {
					this.plugin.settings.templateFolderPath = value;
					await this.plugin.saveSettings();
				});

			new GenericTextSuggester(
				app,
				text.inputEl,
				app.vault
					.getAllLoadedFiles()
					.filter((f) => f instanceof TFolder && f.path !== '/')
					.map((f) => f.path)
			);
		});
	}
}
