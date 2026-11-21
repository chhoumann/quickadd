import type { TFile } from "obsidian";
import { Plugin } from "obsidian";
import { QuickAddSettingsTab } from "./quickAddSettingsTab";
import type { QuickAddSettings } from "./settings";
import { log } from "./logger/logManager";
import { ConsoleErrorLogger } from "./logger/consoleErrorLogger";
import { GuiLogger } from "./logger/guiLogger";
import { reportError } from "./utils/errorUtils";
import { registerUnhandledRejectionReporter } from "./utils/unhandledRejectionReporter";
import { openQuickAddSettings } from "./utils/openPluginSettings";
import { StartupMacroEngine } from "./engine/StartupMacroEngine";
import { ChoiceExecutor } from "./choiceExecutor";
import { createFormatterExecutionRuntime } from "./engine/formatterRuntime";
import type IChoice from "./types/choices/IChoice";
import { hasTemplateExtension, isPathWithinTemplateFolders, normalizeTemplateFolderPaths } from "./utils/templateFolderUtils";
import { openChoiceLauncher } from "./gui/suggesters/openChoiceLauncher";
import { QuickAddApi } from "./quickAddApi";
import migrate from "./migrations/migrate";
import { settingsStore } from "./settingsStore";
import { UpdateModal } from "./gui/UpdateModal/UpdateModal";
import { FieldSuggestionCache } from "./utils/FieldSuggestionCache";
import { FileIndex } from "./utils/vaultIndex/FileIndex";
import { TagIndex } from "./utils/vaultIndex/TagIndex";
import { interactivePromptServer } from "./interactive/interactivePromptServer";
import { parseSemver } from "./utils/semver";
import { registerQuickAddCliHandlers } from "./cli/registerQuickAddCliHandlers";
import { autoSyncEnabledProviders } from "./ai/modelSyncService";
import { QUICK_ADD_COMMAND_LABELS } from "./commandLabels";
import { PromptPeekSession } from "./gui/promptPeek/PromptPeekSession";
import { ingestImagesIntoActivePrompt as ingestPromptImages } from "./gui/imagePasteHandler";
import { setQuickAddInstance } from "./quickAddInstance";
import { registerQuickAddUri } from "./uri/registerQuickAddUri";
import { registerCoreCommands } from "./plugin/registerCoreCommands";
import { ChoiceCommandManager } from "./plugin/choiceCommandManager";
import { SettingsPersistence } from "./plugin/settingsPersistence";
import { scheduleStartupModelSync } from "./ai/startupModelSync";
import { keepFocusedFieldInView } from "./gui/keepFocusedFieldInView";
import { leaveBuilderPages } from "./gui/ChoiceBuilder/builderPage";
import { registerSaveOnExit } from "./plugin/registerSaveOnExit";

export default class QuickAdd extends Plugin {
	settings: QuickAddSettings;
	private unsubscribeSettingsStore: () => void;
	/** Work started before unload can finish after it, and must not touch commands or settings then (#2210). */
	private unloaded = false;
	private readonly settingsPersistence = new SettingsPersistence({
		// Arrows, not bound methods: a test can replace loadData/saveData on the instance.
		loadData: () => this.loadData(),
		saveData: (data) => this.saveData(data),
		getSettings: () => this.settings,
		setSettings: (settings) => {
			this.settings = settings;
		},
		isUnloaded: () => this.unloaded,
		onChoicesReplacedFromDisk: (previousChoices) =>
			this.choiceCommands.replaceCommands(previousChoices),
	});
	private readonly choiceCommands = new ChoiceCommandManager(this, () => this.unloaded);

	get api(): ReturnType<typeof QuickAddApi.GetApi> {
		return QuickAddApi.GetApi(
			this.app,
			this,
			new ChoiceExecutor(this.app, this),
			createFormatterExecutionRuntime(this.app, this),
		);
	}

	ingestImagesIntoActivePrompt(files: File[]) {
		return ingestPromptImages(files);
	}

	async onload() {
		log.logMessage("Loading QuickAdd");
		setQuickAddInstance(this);

		await this.loadSettings();
		settingsStore.replaceState(this.settings);
		this.unsubscribeSettingsStore = settingsStore.subscribe((settings) =>
			this.settingsPersistence.onStoreChange(settings),
		);

		registerCoreCommands(this);
		registerSaveOnExit(this, () => this.flushPendingSave());

		// Start automatic cleanup for field suggestion cache
		const cache = FieldSuggestionCache.getInstance();
		cache.startAutomaticCleanup((intervalId) =>
			this.registerInterval(intervalId),
		);
		cache.registerInvalidationListeners(this.app, (eventRef) =>
			this.registerEvent(eventRef),
		);

		this.addCommand({
			id: "openQuickAddSettings",
			name: QUICK_ADD_COMMAND_LABELS.openSettings,
			callback: () => {
				openQuickAddSettings(this.app, this.manifest.id);
			},
		});

		registerQuickAddUri(
			this,
			(name) => this.findChoiceByName(name),
			(name) => this.choiceCommands.warnIfChoiceNameAmbiguous(name),
		);

		log.register(new ConsoleErrorLogger()).register(new GuiLogger());

		// Must come after the loggers: a QuickAdd promise that rejects with nobody
		// awaiting it (a settings click handler, a floated call) used to leave the user
		// with nothing but a console line. Now it reports through the same channel as
		// every other failure (#1576).
		registerUnhandledRejectionReporter(this);
		keepFocusedFieldInView(this);

		if (this.settings.enableRibbonIcon) {
			this.addRibbonIcon("file-plus", "QuickAdd", () => {
				openChoiceLauncher(this, () => new ChoiceExecutor(this.app, this));
			});
		}

		const settingsTab = new QuickAddSettingsTab(this.app, this);
		this.addSettingTab(settingsTab);
		this.addCommand({
			id: "openAIAssistantSettings",
			name: QUICK_ADD_COMMAND_LABELS.openAISettings,
			callback: () => settingsTab.openAIAssistantPageFromCommand(),
		});

		// Everything from here on reads the choice tree, i.e. untrusted data.json.
		// Each step is isolated so a defect in that data costs one capability
		// instead of the whole plugin: onload throwing leaves Obsidian reporting
		// only "Plugin failure: quickadd", with no commands, no migrations, no CLI
		// and no startup macros, and no way for the user to tell why (#1566).
		// The accessors below handle the corrupt shapes we know about; this is the
		// blast radius bound for the ones nobody has thought of yet.
		this.choiceCommands.addCommandsForChoices(this.settings.choices);

		try {
			await migrate(this);
		} catch (err) {
			reportError(err, "QuickAdd could not run its settings migrations");
		}

		const registerCli = () => {
			try {
				registerQuickAddCliHandlers(this);
			} catch (err) {
				reportError(err, "QuickAdd could not register its CLI handlers");
			}
		};

		if (this.app.workspace.layoutReady) {
			registerCli();
		} else {
			this.app.workspace.onLayoutReady(registerCli);
		}

		// Run startup macros after migrations are complete
		const launchStartupMacros = async () => {
			try {
				await new StartupMacroEngine(
					this.settings.choices,
					new ChoiceExecutor(this.app, this),
				).run();
			} catch (err) {
				reportError(err, "QuickAdd could not run its startup macros");
			}
		};

		if (this.app.workspace.layoutReady) {
			void launchStartupMacros();
		} else {
			this.app.workspace.onLayoutReady(launchStartupMacros);
		}

		// Keep AI provider model lists current without plugin releases: a quiet,
		// daily-throttled background sync for providers that opted in. Deferred
		// past layout-ready so it never competes with startup work, and cancelled
		// if this instance unloads first.
		scheduleStartupModelSync(this, () => {
			void autoSyncEnabledProviders(this.app);
		});

		this.announceUpdate();
	}

	onunload() {
		log.logMessage("Unloading QuickAdd");
		this.unloaded = true;
		// Leave an open choice builder first, so its edits are in the write below.
		leaveBuilderPages(this.app);
		// Flush any pending debounced settings write so a just-made change (e.g. a
		// folder collapse) is never lost on plugin reload.
		void this.flushPendingSave();
		this.unsubscribeSettingsStore?.call(this);

		// Clean up field suggestion cache
		const cache = FieldSuggestionCache.getInstance();
		cache.destroy();
		FileIndex.destroyInstance();
		TagIndex.destroyInstance();

		// Stop the interactive-prompt bridge (closes the localhost server and drops
		// any in-flight sessions) so nothing keeps listening after unload.
		interactivePromptServer.stop();
		PromptPeekSession.getActive()?.cancel();

		// Loading QuickAdd again registers its own loggers and instance.
		log.clear();
		setQuickAddInstance(undefined);
	}

	async loadSettings() {
		await this.settingsPersistence.load();
	}

	/**
	 * Start the pending debounced settings write now. Returns the queued
	 * settings work, or null when there is none to wait for.
	 */
	flushPendingSave(): Promise<void> | null {
		return this.settingsPersistence.flushPendingSave();
	}

	/** Immediate, awaitable settings write (migrations rely on this). */
	async saveSettings() {
		await this.settingsPersistence.saveNow();
	}

	/** Obsidian calls this when `data.json` is newer than QuickAdd's last write. */
	async onExternalSettingsChange(): Promise<void> {
		await this.settingsPersistence.onExternalSettingsChange();
	}

	public addCommandForChoice(choice: IChoice) {
		this.choiceCommands.addCommandForChoice(choice);
	}

	public removeCommandForChoice(
		choice: IChoice,
		options?: { recursive?: boolean },
	) {
		this.choiceCommands.removeCommandForChoice(choice, options);
	}

	public getChoiceById(choiceId: string): IChoice {
		return this.choiceCommands.getChoiceById(choiceId);
	}

	public getChoiceByName(choiceName: string): IChoice {
		return this.choiceCommands.getChoiceByName(choiceName);
	}

	public findChoiceById(choiceId: string): IChoice | null {
		return this.choiceCommands.findChoiceById(choiceId);
	}

	public findChoiceByName(choiceName: string): IChoice | null {
		return this.choiceCommands.findChoiceByName(choiceName);
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
		// `isFeatureUpdate`: the "major" announce tier promises "new features, breaking
		// changes". QuickAdd ships features as semantic-release feat: commits, which become
		// MINOR bumps (e.g. 2.13.x -> 2.14.0), never MAJOR — so gating purely on the major
		// digit (isMajorUpdate) would suppress the modal for every feature release. Treat a
		// major OR minor increase as a feature update so feature releases are announced as
		// documented, while patch-only bumps stay quiet. Unparseable versions fall back to
		// showing the update (mirrors isMajorUpdate's err-on-the-side-of-showing default).
		const isFeatureUpdate = (
			currentVersion: string,
			previousVersion: string,
		): boolean => {
			const current = parseSemver(currentVersion);
			const previous = parseSemver(previousVersion);
			if (!current || !previous) return true;
			if (current.major !== previous.major)
				return current.major > previous.major;
			return current.minor > previous.minor;
		};

		const currentVersion = this.manifest.version;
		const knownVersion = this.settings.version;

		if (currentVersion === knownVersion) return;

		const preference = this.settings.announceUpdates;
		let shouldAnnounce = true;

		if (preference === "none") {
			shouldAnnounce = false;
		} else if (
			preference === "major" &&
			!isFeatureUpdate(currentVersion, knownVersion)
		) {
			shouldAnnounce = false;
		}

		this.settings.version = currentVersion;
		void this.saveSettings();

		if (!shouldAnnounce) return;

		const updateModal = new UpdateModal(this.app, knownVersion);
		updateModal.open();
	}
}
