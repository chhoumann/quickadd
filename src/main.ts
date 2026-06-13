/** biome-ignore-all assist/source/organizeImports: Import order is critical to prevent circular dependencies - ChoiceExecutor must load before dependent classes */
import type { Debouncer } from "obsidian";
import { Plugin, TFile, debounce } from "obsidian";
import { QuickAddSettingsTab } from "./quickAddSettingsTab";
import { DEFAULT_SETTINGS } from "./settings";
import type { QuickAddSettings } from "./settings";
import { log } from "./logger/logManager";
import { ConsoleErrorLogger } from "./logger/consoleErrorLogger";
import { GuiLogger } from "./logger/guiLogger";
import { LogManager } from "./logger/logManager";
import { reportError } from "./utils/errorUtils";
import { StartupMacroEngine } from "./engine/StartupMacroEngine";
import { ChoiceExecutor } from "./choiceExecutor";
import type IChoice from "./types/choices/IChoice";
import type IMultiChoice from "./types/choices/IMultiChoice";
import {
	deleteObsidianCommand,
	hasTemplateExtension,
	isPathWithinTemplateFolders,
	normalizeTemplateFolderPaths,
} from "./utilityObsidian";
import ChoiceSuggester from "./gui/suggesters/choiceSuggester";
import { QuickAddApi } from "./quickAddApi";
import migrate from "./migrations/migrate";
import { settingsStore } from "./settingsStore";
import { UpdateModal } from "./gui/UpdateModal/UpdateModal";
import { CommandType } from "./types/macros/CommandType";
import { InfiniteAIAssistantCommandSettingsModal } from "./gui/MacroGUIs/AIAssistantInfiniteCommandSettingsModal";
import { FieldSuggestionCache } from "./utils/FieldSuggestionCache";
import { isMajorUpdate } from "./utils/semver";
import { resolveChoiceIcon } from "./utils/choiceUtils";
import { registerQuickAddCliHandlers } from "./cli/registerQuickAddCliHandlers";
import { QUICK_ADD_COMMAND_LABELS } from "./commandLabels";
import { setQuickAddInstance } from "./quickAddInstance";
import { applyTemplateToNote } from "./engine/applyTemplateToActiveNote";

// Parameters prefixed with `value-` get used as named values for the executed choice
type CaptureValueParameters = { [key in `value-${string}`]?: string };

interface DefinedUriParameters {
	choice?: string; // Name
}

type UriParameters = DefinedUriParameters & CaptureValueParameters;

// The settingsStore subscriber fires on every store change — including high-frequency
// ones like folder collapse toggles. Coalesce those full-settings disk writes into one
// per burst (saveData rewrites the whole data.json); flushed on unload so nothing is lost.
const SETTINGS_SAVE_DEBOUNCE_MS = 1000;

export default class QuickAdd extends Plugin {
	settings: QuickAddSettings;
	private unsubscribeSettingsStore: () => void;
	// Debounced disk write for the store subscriber. saveSettings() stays immediate
	// (migrations await it) and cancels this; onunload flushes it.
	private requestSave: Debouncer<[], void> = debounce(
		() => void this.saveData(this.settings),
		SETTINGS_SAVE_DEBOUNCE_MS,
	);

	get api(): ReturnType<typeof QuickAddApi.GetApi> {
		return QuickAddApi.GetApi(
			this.app,
			this,
			new ChoiceExecutor(this.app, this),
		);
	}

	async onload() {
		log.logMessage("Loading QuickAdd");
		setQuickAddInstance(this);

		await this.loadSettings();
		settingsStore.replaceState(this.settings);
		this.unsubscribeSettingsStore = settingsStore.subscribe((settings) => {
			this.settings = settings;
			this.requestSave();
		});

		this.addCommand({
			id: "runQuickAdd",
			name: QUICK_ADD_COMMAND_LABELS.run,
			callback: () => {
				ChoiceSuggester.Open(this, this.settings.choices);
			},
		});

		this.addCommand({
			id: "applyTemplateToActiveFile",
			name: QUICK_ADD_COMMAND_LABELS.applyTemplate,
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				const available = file?.extension === "md";
				if (checking) return available;
				if (!available) return;

				void applyTemplateToNote(this.app, this, {
					file,
					choiceExecutor: new ChoiceExecutor(this.app, this),
				});
			},
		});

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, abstractFile) => {
				if (!(abstractFile instanceof TFile)) return;
				if (abstractFile.extension !== "md") return;

				menu.addItem((item) =>
					item
						.setTitle("Apply QuickAdd template")
						.setIcon("file-plus")
						.onClick(() => {
							void applyTemplateToNote(this.app, this, {
								file: abstractFile,
								choiceExecutor: new ChoiceExecutor(this.app, this),
							});
						}),
				);
			}),
		);

		this.addCommand({
			id: "reloadQuickAdd",
			name: QUICK_ADD_COMMAND_LABELS.reloadDev,
			checkCallback: (checking) => {
				if (checking) {
					return this.settings.devMode;
				}

				const id: string = this.manifest.id;
				const plugins = this.app.plugins;
				void plugins.disablePlugin(id).then(() => plugins.enablePlugin(id));
			},
		});

		// Start automatic cleanup for field suggestion cache
		const cache = FieldSuggestionCache.getInstance();
		cache.startAutomaticCleanup((intervalId) =>
			this.registerInterval(intervalId),
		);

		this.addCommand({
			id: "testQuickAdd",
			name: QUICK_ADD_COMMAND_LABELS.testDev,
			checkCallback: (checking) => {
				if (checking) {
					return this.settings.devMode;
				}

				log.logMessage(QUICK_ADD_COMMAND_LABELS.testDev);

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
					new Error(
						`URI could not find any choice named '${parameters.choice}'`,
					),
					"URI handler error",
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
		}

		this.addSettingTab(new QuickAddSettingsTab(this.app, this));

		this.addCommandsForChoices(this.settings.choices);

		await migrate(this);

		const registerCli = () => {
			registerQuickAddCliHandlers(this);
		};

		if (this.app.workspace.layoutReady) {
			registerCli();
		} else {
			this.app.workspace.onLayoutReady(registerCli);
		}

		// Run startup macros after migrations are complete
		const launchStartupMacros = () =>
			new StartupMacroEngine(
				this.app,
				this,
				this.settings.choices,
				new ChoiceExecutor(this.app, this),
			).run();

		if (this.app.workspace.layoutReady) {
			void launchStartupMacros();
		} else {
			this.app.workspace.onLayoutReady(launchStartupMacros);
		}
		this.announceUpdate();
	}

	onunload() {
		log.logMessage("Unloading QuickAdd");
		// Flush any pending debounced settings write so a just-made change (e.g. a
		// folder collapse) is never lost on plugin reload / app quit.
		this.requestSave.run();
		this.unsubscribeSettingsStore?.call(this);

		// Clear the error log to prevent memory leaks
		LogManager.loggers.forEach((logger) => {
			if (logger instanceof ConsoleErrorLogger) {
				logger.clearErrorLog();
			}
		});

		// Clean up field suggestion cache
		const cache = FieldSuggestionCache.getInstance();
		cache.destroy();
	}

	async loadSettings() {
		const loadedData = await this.loadData();
		const settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			loadedData,
		) as QuickAddSettings & {
			announceUpdates: QuickAddSettings["announceUpdates"] | boolean;
		};

		if (typeof settings.announceUpdates === "boolean") {
			settings.announceUpdates = settings.announceUpdates ? "all" : "none";
		}

		this.settings = settings;
	}

	async saveSettings() {
		// Immediate, awaitable write (migrations rely on this). Supersede any pending
		// debounced write so the same settings aren't redundantly rewritten after.
		this.requestSave.cancel();
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
			const choiceId = choice.id;

			this.addCommand({
				id: `choice:${choiceId}`,
				name: choice.name,
				icon: resolveChoiceIcon(choice),
				callback: async () => {
					try {
						const current = this.getChoiceById(choiceId);
						await new ChoiceExecutor(this.app, this).execute(current);
					} catch (err) {
						reportError(err, `Error executing choice ${choiceId}`);
					}
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
		const folders = normalizeTemplateFolderPaths(
			this.settings.templateFolderPaths,
		);
		// Only files the engine can actually resolve are useful suggestions; an
		// empty folder list means "suggest every template file in the vault".
		return this.app.vault
			.getFiles()
			.filter((file) => hasTemplateExtension(file.path))
			.filter((file) => isPathWithinTemplateFolders(file.path, folders));
	}

	private announceUpdate() {
		const currentVersion = this.manifest.version;
		const knownVersion = this.settings.version;

		if (currentVersion === knownVersion) return;

		const preference = this.settings.announceUpdates;
		let shouldAnnounce = true;

		if (preference === "none") {
			shouldAnnounce = false;
		} else if (preference === "major" && !isMajorUpdate(currentVersion, knownVersion)) {
			shouldAnnounce = false;
		}

		this.settings.version = currentVersion;
		void this.saveSettings();

		if (!shouldAnnounce) return;

		const updateModal = new UpdateModal(this.app, knownVersion);
		updateModal.open();
	}
}
