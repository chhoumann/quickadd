import {Plugin} from 'obsidian';
import {DEFAULT_SETTINGS, QuickAddSettingsTab} from "./quickAddSettingsTab";


export default class QuickAdd extends Plugin {
	settings: QuickAddSettingsTab;

	async onload() {
		console.log('Loading QuickAdd');

		await this.loadSettings();

		this.addCommand({
			id: 'runQuickAdd',
			name: 'Run QuickAdd',
			callback: () => {

			}
		})

		/*START.DEVCMD*/
		this.addCommand({
			id: 'reloadQuickAdd',
			name: 'Reload QuickAdd (dev)',
			callback: () => { // @ts-ignore - for this.app.plugins
				const id: string = this.manifest.id, plugins = this.app.plugins;
				plugins.disablePlugin(id).then(() => plugins.enablePlugin(id));
			},
		});
		/*END.DEVCMD*/

		this.addSettingTab(new QuickAddSettingsTab(this.app, this));
	}

	onunload() {
		console.log('Unloading QuickAdd');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

