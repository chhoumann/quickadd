import {App, PluginSettingTab, Setting} from "obsidian";
import type QuickAdd from "./main";
import type {Choice} from "./types/choices/choice";

export interface QuickAddSettings {
    choices: Choice[];
}

export const DEFAULT_SETTINGS: QuickAddSettings = {
    choices: []
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