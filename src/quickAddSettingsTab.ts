import {App, PluginSettingTab, Setting} from "obsidian";
import type QuickAdd from "./main";
import type IChoice from "./types/choices/IChoice";
import ChoiceList from "./gui/choiceList/ChoiceView.svelte"

export interface QuickAddSettings {
    choices: IChoice[];
}

export const DEFAULT_SETTINGS: QuickAddSettings = {
    choices: []
}

export class QuickAddSettingsTab extends PluginSettingTab {
    public plugin: QuickAdd;
    private choiceList: ChoiceList;

    constructor(app: App, plugin: QuickAdd) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        let {containerEl} = this;
        containerEl.empty();

        containerEl.createEl('h2', {text: 'QuickAdd Settings'});
        const choicesDiv = containerEl.createDiv('choices');

        this.choiceList = new ChoiceList({
            target: choicesDiv,
            props: {
                app: this.app,
                choices: this.plugin.settings.choices,
                saveChoices: async (choices: IChoice[]) => {
                    this.plugin.settings.choices = choices;
                    await this.plugin.saveSettings();
                }
            }
        })
    }

    hide(): any {
        this.choiceList.$destroy();
    }
}