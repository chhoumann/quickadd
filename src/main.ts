import {Plugin} from 'obsidian';
import {DEFAULT_SETTINGS, QuickAddSettings, QuickAddSettingsTab} from "./quickAddSettingsTab";
import {ChoiceType} from "./types/choices/choiceType";
import type IMultiChoice from "./types/choices/IMultiChoice";
import {v4 as uuidv4} from "uuid";
export default class QuickAdd extends Plugin {
	settings: QuickAddSettings;

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

		/*START.DEVCMD*/
		this.addCommand({
			id: 'giveDivChoices',
			name: 'Give Dev Choices',
			callback: () => {
				this.settings.choices = [
					{name: '🚶‍♂️ Journal', type: ChoiceType.Template, id: uuidv4()},
					{name: '📖 Log Book to Daily Journal', type: ChoiceType.Template, id: uuidv4()},
					<IMultiChoice>{
						name: '📥 Add...', type: ChoiceType.Multi, id: uuidv4(), collapsed: false, choices: [
							{name: '💭 Add a Thought', type: ChoiceType.Capture, id: uuidv4()},
							{name: '📥 Add an Inbox Item', type: ChoiceType.Template, id: uuidv4()},
							{name: '📕 Add Book Notes', type: ChoiceType.Template, id: uuidv4()},
						]
					},
					{name: "✍ Quick Capture", type: ChoiceType.Capture, id: uuidv4()},
					{name: '💬 Add Quote Page', type: ChoiceType.Template, id: uuidv4()},
					<IMultiChoice>{
						name: '🌀 Task Manager', type: ChoiceType.Multi, id: uuidv4(), collapsed: false, choices: [
							{name: '✔ Add a Task', type: ChoiceType.Macro, id: uuidv4()},
							{name: '✔ Quick Capture Task', type: ChoiceType.Capture, id: uuidv4()},
							{name: '✔ Add MetaEdit Backlog Task', type: ChoiceType.Capture, id: uuidv4()},
						]
					},
					{name: '💸 Add Purchase', type: ChoiceType.Capture, id: uuidv4()}
				];

				this.saveSettings();
			}
		})
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

