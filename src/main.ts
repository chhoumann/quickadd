import { MarkdownView, Plugin, TFile } from "obsidian";
import { DEFAULT_SETTINGS, QuickAddSettingsTab } from "./quickAddSettingsTab";
import type { QuickAddSettings } from "./quickAddSettingsTab";
import { log } from "./logger/logManager";
import { ConsoleErrorLogger } from "./logger/consoleErrorLogger";
import { GuiLogger } from "./logger/guiLogger";
import { StartupMacroEngine } from "./engine/StartupMacroEngine";
import { ChoiceType } from "./types/choices/choiceType";
import { ChoiceExecutor } from "./choiceExecutor";
import type IChoice from "./types/choices/IChoice";
import type IMultiChoice from "./types/choices/IMultiChoice";
import { deleteObsidianCommand } from "./utility";
import ChoiceSuggester from "./gui/suggesters/choiceSuggester";
import { QuickAddApi } from "./quickAddApi";
import migrate from "./migrations/migrate";
import { settingsStore } from "./settingsStore";

export default class QuickAdd extends Plugin {
	static instance: QuickAdd;
	settings: QuickAddSettings;

	private unsubscribeSettingsStore: () => void;

	get api(): ReturnType<typeof QuickAddApi.GetApi> {
		return QuickAddApi.GetApi(app, this, new ChoiceExecutor(app, this));
	}

	async onload() {
		console.log("Loading QuickAdd");
		QuickAdd.instance = this;

		await this.loadSettings();
		settingsStore.setState(this.settings);
		this.unsubscribeSettingsStore = settingsStore.subscribe((settings) => {	
			this.settings = settings;
			this.saveSettings();
		});

		this.addCommand({
			id: "runQuickAdd",
			name: "Run QuickAdd",
			callback: () => {
				ChoiceSuggester.Open(this, this.settings.choices);
			},
		});

		this.addCommand({
			id: "reloadQuickAdd",
			name: "Reload QuickAdd (dev)",
			checkCallback: (checking) => {
				if (checking) {
					return this.settings.devMode;
				}

				const id: string = this.manifest.id,
					plugins = this.app.plugins;
				plugins.disablePlugin(id).then(() => plugins.enablePlugin(id));
			},
		});

		this.addCommand({
			id: "testQuickAdd",
			name: "Test QuickAdd (dev)",
			checkCallback: (checking) => {
				if (checking) {
					return this.settings.devMode;
				}

				console.log(`Test QuickAdd (dev)`);

				const fn = async () => {
					const activeView =
						await this.app.workspace.getActiveViewOfType(
							MarkdownView
						);
					if (!activeView) return false;

					const x = this.app.workspace.getLeaf("tab");
					x.openFile(activeView.file);
				};

				fn();
			},
		});

		log.register(new ConsoleErrorLogger()).register(new GuiLogger(this));

		this.addSettingTab(new QuickAddSettingsTab(this.app, this));

		this.app.workspace.onLayoutReady(() =>
			new StartupMacroEngine(
				this.app,
				this,
				this.settings.macros,
				new ChoiceExecutor(this.app, this)
			).run()
		);
		this.addCommandsForChoices(this.settings.choices);

		migrate(this);
	}

	onunload() {
		console.log("Unloading QuickAdd");
		this.unsubscribeSettingsStore?.call(this);
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private addCommandsForChoices(choices: IChoice[]) {
		choices.forEach((choice) => this.addCommandForChoice(choice));
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
				},
			});
		}
	}

	public getChoiceById(choiceId: string): IChoice {
		const choice = this.getChoice("id", choiceId);

		if (!choice) {
			throw new Error(`Choice ${choiceId} not found`);
		}

		return choice;
	}

	public getChoiceByName(choiceName: string): IChoice {
		const choice = this.getChoice("name", choiceName);

		if (!choice) {
			throw new Error(`Choice ${choiceName} not found`);
		}

		return choice;
	}

	private getChoice(
		by: "name" | "id",
		targetPropertyValue: string,
		choices: IChoice[] = this.settings.choices
	): IChoice | null {
		for (const choice of choices) {
			if (choice[by] === targetPropertyValue) {
				return choice;
			}
			if (choice.type === ChoiceType.Multi) {
				const subChoice = this.getChoice(
					by,
					targetPropertyValue,
					(choice as IMultiChoice).choices
				);
				if (subChoice) {
					return subChoice;
				}
			}
		}

		return null;
	}

	public removeCommandForChoice(choice: IChoice) {
		deleteObsidianCommand(this.app, `quickadd:choice:${choice.id}`);
	}

	public getTemplateFiles(): TFile[] {
		if (!String.isString(this.settings.templateFolderPath)) return [];

		return this.app.vault
			.getFiles()
			.filter((file) =>
				file.path.startsWith(this.settings.templateFolderPath)
			);
	}
}
