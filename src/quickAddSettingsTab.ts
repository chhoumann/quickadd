import {App, PluginSettingTab, Setting} from "obsidian";
import type QuickAdd from "./main";
import type IChoice from "./types/choices/IChoice";
import ChoiceView from "./gui/choiceList/ChoiceView.svelte"
import type {IMacro} from "./types/macros/IMacro";

export interface QuickAddSettings {
    choices: IChoice[];
    macros: IMacro[];
}

export const DEFAULT_SETTINGS: QuickAddSettings = {
    choices: [],
    macros: []
}

export class QuickAddSettingsTab extends PluginSettingTab {
    public plugin: QuickAdd;
    private choiceView: ChoiceView;

    constructor(app: App, plugin: QuickAdd) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        let {containerEl} = this;
        containerEl.empty();
        containerEl.createEl('h2', {text: 'QuickAdd Settings'});

        this.addChoicesSetting();
    }

    hide(): any {
        if (this.choiceView)
            this.choiceView.$destroy();
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
                }
            }
        });
    }
}