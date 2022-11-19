import { App, PluginSettingTab, Setting } from "obsidian";
import { Root } from "react-dom/client";
import Create from "./gui/newChoiceList";
import type QuickAdd from "./main";
import type IChoice from "./types/choices/IChoice";
import type { IMacro } from "./types/macros/IMacro";
import ChoiceView from "./gui/choiceList/ChoiceView.svelte";

export interface QuickAddSettings {
	choices: IChoice[];
	macros: IMacro[];
	inputPrompt: "multi-line" | "single-line";
	devMode: boolean;
}

export const DEFAULT_SETTINGS: QuickAddSettings = {
	choices: [],
	macros: [],
	inputPrompt: "single-line",
	devMode: false,
};

export class QuickAddSettingsTab extends PluginSettingTab {
	public plugin: QuickAdd;
	private choiceView: Root;
	private _choiceView: ChoiceView = ChoiceView; // builds die if this doesn't happen. IDK why yet.

	constructor(app: App, plugin: QuickAdd) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		let { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "QuickAdd Settings" });

		this.addChoicesSetting();

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

	hide(): any {
		if (this.choiceView) this.choiceView.unmount();
	}

	private addChoicesSetting(): void {
		const setting = new Setting(this.containerEl);
		setting.infoEl.remove();
		setting.settingEl.style.display = "block";

        this.choiceView = Create(setting.settingEl, {
            choices: this.plugin.settings.choices,
        });
	}
}
