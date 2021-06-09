import {App, PluginSettingTab, Setting} from "obsidian";
import type QuickAdd from "./main";

export interface QuickAddSettings {

}

export const DEFAULT_SETTINGS: QuickAddSettings = {
}

export class QuickAddSettingsTab extends PluginSettingTab {
    plugin: QuickAdd;

    constructor(app: App, plugin: QuickAdd) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        let {containerEl} = this;
        containerEl.empty();

        containerEl.createEl('h2', {text: 'QuickAdd Settings'});
    }
}