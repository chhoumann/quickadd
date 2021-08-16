import {Plugin} from 'obsidian';
import {DEFAULT_SETTINGS, QuickAddSettings, QuickAddSettingsTab} from "./quickAddSettingsTab";
import ChoiceSuggester from "./gui/choiceSuggester";
import {log} from "./logger/logManager";
import {ConsoleErrorLogger} from "./logger/consoleErrorLogger";
import {GuiLogger} from "./logger/guiLogger";
import {StartupMacroEngine} from "./engine/StartupMacroEngine";
import {ChoiceType} from "./types/choices/choiceType";
import {ChoiceExecutor} from "./choiceExecutor";
import type IChoice from "./types/choices/IChoice";
import type IMultiChoice from "./types/choices/IMultiChoice";
import {deleteObsidianCommand} from "./utility";
import type IMacroChoice from "./types/choices/IMacroChoice";

export default class QuickAdd extends Plugin {
	static instance;
	settings: QuickAddSettings;

	async onload() {
		console.log('Loading QuickAdd');
		QuickAdd.instance = this;

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

		log.register(new ConsoleErrorLogger())
			.register(new GuiLogger(this));

		this.addSettingTab(new QuickAddSettingsTab(this.app, this));

		this.app.workspace.onLayoutReady( () =>
			new StartupMacroEngine(this.app, this, this.settings.macros, new ChoiceExecutor(this.app, this)).run());
		this.addCommandsForChoices(this.settings.choices);

		await this.convertMacroChoicesMacroToId();
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

	private addCommandsForChoices(choices: IChoice[]) {
		choices.forEach(choice => this.addCommandForChoice(choice));
	}

	public addCommandForChoice(choice: IChoice) {
		if (choice.type === ChoiceType.Multi) {
		    this.addCommandsForChoices((<IMultiChoice>choice).choices);
		}

		if (choice.command) {
			this.addCommand({
				id: `choice:${choice.id}`,
				name: choice.name,
				callback: async () => {
					await new ChoiceExecutor(this.app, this).execute(choice);
				}
			});
		}
	}

	public getChoiceById(choiceId: string): IChoice {
		return this.getChoice("id", choiceId);
	}

	public getChoiceByName(choiceName: string): IChoice {
		return this.getChoice("name", choiceName);
	}

	private getChoice(by: "name" | "id", targetPropertyValue: string): IChoice {
		let tempChoice: IChoice;

		const findChoice = (choice: IChoice) => {
			if (choice[by] === targetPropertyValue) {
				tempChoice = choice;
				return tempChoice;
			}

			if (choice.type === ChoiceType.Multi) (choice as IMultiChoice).choices.forEach(findChoice);
		}

		this.settings.choices.forEach(findChoice);

		return tempChoice;
	}

	public removeCommandForChoice(choice: IChoice) {
		deleteObsidianCommand(this.app, `quickadd:choice:${choice.id}`);
	}

	// Did not make sense to have copies of macros in the choices when they are maintained for themselves.
	// Instead we reference by id now. Have to port this over for all users.
	private async convertMacroChoicesMacroToId() {
	    function convertMacroChoiceMacroToIdHelper(choice: IChoice): IChoice {
	    	if (choice.type === ChoiceType.Multi) {
	    		let multiChoice = (choice as IMultiChoice);
	    		const multiChoices = multiChoice.choices.map(convertMacroChoiceMacroToIdHelper);
	    		multiChoice = {...multiChoice, choices: multiChoices};
	    		return multiChoice;
	    	}

			if (choice.type !== ChoiceType.Macro) return choice;
			const macroChoice = choice as IMacroChoice;

			if (macroChoice.macro) {
				macroChoice.macroId = macroChoice.macro.id;
				delete macroChoice.macro;
			}

			return macroChoice;
		}

		this.settings.choices = this.settings.choices.map(convertMacroChoiceMacroToIdHelper);

		await this.saveSettings();
	}
}

