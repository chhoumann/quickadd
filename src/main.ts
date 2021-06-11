import {Plugin} from 'obsidian';
import {DEFAULT_SETTINGS, QuickAddSettings, QuickAddSettingsTab} from "./quickAddSettingsTab";
import {TemplateChoice} from "./types/choices/TemplateChoice";
import {MultiChoice} from "./types/choices/MultiChoice";
import {CaptureChoice} from "./types/choices/CaptureChoice";
import {MacroChoice} from "./types/choices/MacroChoice";
import ChoiceSuggester from "./gui/choiceSuggester";
import {log} from "./logger/logManager";
import {QuickAddLogger} from "./logger/quickAddLogger";
import {ConsoleErrorLogger} from "./logger/consoleErrorLogger";
import {GuiLogger} from "./logger/guiLogger";

export default class QuickAdd extends Plugin {
	settings: QuickAddSettings;

	async onload() {
		console.log('Loading QuickAdd');

		await this.loadSettings();

		this.addCommand({
			id: 'runQuickAdd',
			name: 'Run QuickAdd',
			callback: () => {
				ChoiceSuggester.Open(this, this.settings.choices);
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
					new TemplateChoice("🚶‍♂️ Journal"),
					new TemplateChoice('📖 Log Book to Daily Journal'),
					new MultiChoice('📥 Add...')
						.addChoice(new CaptureChoice('💭 Add a Thought'))
						.addChoice(new CaptureChoice('📥 Add an Inbox Item'))
						.addChoice(new TemplateChoice('📕 Add Book Notes')),
                    new CaptureChoice("✍ Quick Capture"),
                    new TemplateChoice('💬 Add Quote Page'),
					new MultiChoice('🌀 Task Manager')
						.addChoice(new MacroChoice('✔ Add a Task'))
						.addChoice(new CaptureChoice('✔ Quick Capture Task'))
						.addChoice(new CaptureChoice('✔ Add MetaEdit Backlog Task')),
                    new CaptureChoice('💸 Add Purchase'),
				];

				this.saveSettings();
			}
		})
		/*END.DEVCMD*/

		log.register(new ConsoleErrorLogger())
			.register(new GuiLogger(this));

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

