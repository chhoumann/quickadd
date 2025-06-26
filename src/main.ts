import type { TFile } from "obsidian";
import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, QuickAddSettingsTab } from "./quickAddSettingsTab";
import type { QuickAddSettings } from "./quickAddSettingsTab";
import { log } from "./logger/logManager";
import { ConsoleErrorLogger } from "./logger/consoleErrorLogger";
import { GuiLogger } from "./logger/guiLogger";
import { LogManager } from "./logger/logManager";
import { reportError } from "./utils/errorUtils";
import { StartupMacroEngine } from "./engine/StartupMacroEngine";
import { ChoiceExecutor } from "./choiceExecutor";
import type IChoice from "./types/choices/IChoice";
import type IMultiChoice from "./types/choices/IMultiChoice";
import { deleteObsidianCommand } from "./utilityObsidian";
import ChoiceSuggester from "./gui/suggesters/choiceSuggester";
import { QuickAddApi } from "./quickAddApi";
import migrate from "./migrations/migrate";
import { settingsStore } from "./settingsStore";
import { UpdateModal } from "./gui/UpdateModal/UpdateModal";
import { CommandType } from "./types/macros/CommandType";
import { InfiniteAIAssistantCommandSettingsModal } from "./gui/MacroGUIs/AIAssistantInfiniteCommandSettingsModal";
import { FieldSuggestionCache } from "./utils/FieldSuggestionCache";
import { commandHistory } from "./history/CommandHistory";

// Parameters prefixed with `value-` get used as named values for the executed choice
type CaptureValueParameters = { [key in `value-${string}`]?: string };

interface DefinedUriParameters {
	choice?: string; // Name
}

type UriParameters = DefinedUriParameters & CaptureValueParameters;

export default class QuickAdd extends Plugin {
	static instance: QuickAdd;
	settings!: QuickAddSettings;
	private unsubscribeSettingsStore!: () => void;

	get api(): ReturnType<typeof QuickAddApi.GetApi> {
		return QuickAddApi.GetApi(this.app, this, new ChoiceExecutor(this.app, this));
	}

	async onload() {
		console.log("Loading QuickAdd");
		QuickAdd.instance = this;

		await this.loadSettings();
		settingsStore.setState(this.settings);
		this.unsubscribeSettingsStore = settingsStore.subscribe((settings) => {
			this.settings = settings;
			void this.saveSettings();
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

				const id: string = this.manifest.id;
				const plugins = this.app.plugins;
				void plugins.disablePlugin(id).then(() => plugins.enablePlugin(id));
			},
		});

		this.addCommand({
			id: "undoQuickAdd",
			name: "Undo QuickAdd Action",
			hotkeys: [{ modifiers: ["Mod"], key: "z" }],
			checkCallback: (checking) => {
				if (checking) {
					return commandHistory.canUndo();
				}

				void commandHistory.undo();
			},
		});

		this.addCommand({
			id: "redoQuickAdd",
			name: "Redo QuickAdd Action",
			hotkeys: [{ modifiers: ["Mod", "Shift"], key: "z" }],
			checkCallback: (checking) => {
				if (checking) {
					return commandHistory.canRedo();
				}

				void commandHistory.redo();
			},
		});

		this.addCommand({
			id: "quickadd-history",
			name: "Show QuickAdd History",
			callback: async () => {
				const { CommandHistoryModal } = await import("./gui/CommandHistoryModal");
				new CommandHistoryModal(this.app).open();
			},
		});

		// Start automatic cleanup for field suggestion cache
		const cache = FieldSuggestionCache.getInstance();
		cache.startAutomaticCleanup((intervalId) => this.registerInterval(intervalId));

		this.addCommand({
			id: "testQuickAdd",
			name: "Test QuickAdd (dev)",
			checkCallback: (checking) => {
				if (checking) {
					return this.settings.devMode;
				}

				console.log("Test QuickAdd (dev)");

				const fn = () => {
					new InfiniteAIAssistantCommandSettingsModal(this.app, {
						id: "test",
						name: "Test",
						model: "gpt-4",
						modelParameters: {},
						outputVariableName: "test",
						systemPrompt: "test",
						type: CommandType.AIAssistant,
						resultJoiner: "\\n",
						chunkSeparator: "\\n",
						maxChunkTokens: 100,
						mergeChunks: false,
					});
				};

				void fn();
			},
		});

		this.registerObsidianProtocolHandler("quickadd", async (e) => {
			const parameters = e as unknown as UriParameters;
			if (!parameters.choice) {
				log.logWarning("URI was executed without a `choice` parameter.");
				return;
			}
			const choice = this.getChoice("name", parameters.choice);

			if (!choice) {
				reportError(
					new Error(`URI could not find any choice named '${parameters.choice}'`),
					"URI handler error"
				);
				return;
			}

			const choiceExecutor = new ChoiceExecutor(this.app, this);
			Object.entries(parameters)
				.filter(([key]) => key.startsWith("value-"))
				.forEach(([key, value]) => {
					choiceExecutor.variables.set(key.slice(6), value);
				});

			try {
				await choiceExecutor.execute(choice);
			} catch (err) {
				reportError(err, "Error executing choice from URI");
			}
		});

		log.register(new ConsoleErrorLogger()).register(new GuiLogger(this));

		if (this.settings.enableRibbonIcon) {
			this.addRibbonIcon("file-plus", "QuickAdd", () => {
				ChoiceSuggester.Open(this, this.settings.choices);
			});

			// Undo / Redo ribbon icons
			this.addRibbonIcon("rotate-ccw", "Undo QuickAdd Action", () => {
				void commandHistory.undo();
			});
			this.addRibbonIcon("rotate-cw", "Redo QuickAdd Action", () => {
				void commandHistory.redo();
			});
		}

		this.addSettingTab(new QuickAddSettingsTab(this.app, this));

		this.app.workspace.onLayoutReady(() =>
			new StartupMacroEngine(
				this.app,
				this,
				this.settings.macros,
				new ChoiceExecutor(this.app, this),
			).run(),
		);
		this.addCommandsForChoices(this.settings.choices);

		await migrate(this);
		this.announceUpdate();
	}

	onunload() {
		console.log("Unloading QuickAdd");
		this.unsubscribeSettingsStore?.call(this);
		
		// Clear the error log to prevent memory leaks
		LogManager.loggers.forEach(logger => {
			if (logger instanceof ConsoleErrorLogger) {
				logger.clearErrorLog();
			}
		});

		// Clean up field suggestion cache
		const cache = FieldSuggestionCache.getInstance();
		cache.destroy();
	}

	async loadSettings() {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private addCommandsForChoices(choices: IChoice[]) {
		for (const choice of choices) {
			this.addCommandForChoice(choice);
		}
	}

	public addCommandForChoice(choice: IChoice) {
		if (choice.type === "Multi") {
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
		choices: IChoice[] = this.settings.choices,
	): IChoice | null {
		for (const choice of choices) {
			if (choice[by] === targetPropertyValue) {
				return choice;
			}
			if (choice.type === "Multi") {
				const subChoice = this.getChoice(
					by,
					targetPropertyValue,
					(choice as IMultiChoice).choices,
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
			.filter((file) => file.path.startsWith(this.settings.templateFolderPath));
	}

	private announceUpdate() {
		const currentVersion = this.manifest.version;
		const knownVersion = this.settings.version;

		if (currentVersion === knownVersion) return;

		this.settings.version = currentVersion;
		void this.saveSettings();

		if (this.settings.announceUpdates === false) return;

		const updateModal = new UpdateModal(this.app, knownVersion);
		updateModal.open();
	}
}
