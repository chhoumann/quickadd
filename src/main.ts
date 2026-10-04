/** biome-ignore-all assist/source/organizeImports: Import order is critical to prevent circular dependencies - ChoiceExecutor must load before dependent classes */
import type { TFile } from "obsidian";
import { Plugin } from "obsidian";
import { QuickAddSettingsTab } from "./quickAddSettingsTab";
import { DEFAULT_SETTINGS } from "./settings";
import type { QuickAddSettings } from "./settings";
import { log } from "./logger/logManager";
import { ConsoleErrorLogger } from "./logger/consoleErrorLogger";
import { GuiLogger } from "./logger/guiLogger";
import { LogManager } from "./logger/logManager";
import {
	reportError,
	reportUnlessCancelled,
} from "./utils/errorUtils";
import { registerUnhandledRejectionReporter } from "./utils/unhandledRejectionReporter";
import { openQuickAddSettings } from "./utils/openPluginSettings";
import { StartupMacroEngine } from "./engine/StartupMacroEngine";
import { ChoiceExecutor } from "./choiceExecutor";
import type IChoice from "./types/choices/IChoice";
import { hasTemplateExtension, isPathWithinTemplateFolders, normalizeTemplateFolderPaths } from "./utils/templateFolderUtils";
import { openChoiceLauncher } from "./gui/suggesters/openChoiceLauncher";
import { QuickAddApi } from "./quickAddApi";
import migrate from "./migrations/migrate";
import { walkChoicesInSettings } from "./migrations/helpers/choice-traversal";
import { settingsStore } from "./settingsStore";
import { UpdateModal } from "./gui/UpdateModal/UpdateModal";
import { FieldSuggestionCache } from "./utils/FieldSuggestionCache";
import { deepClone } from "./utils/deepClone";
import {
	reconcileSettingsPersistPlan,
	settingsValuesEqual,
	shouldApplyPersistedWriteToStore,
	threeWayMergeSettings,
} from "./utils/settingsPersistMerge";
import { interactivePromptServer } from "./interactive/interactivePromptServer";
import { parseSemver } from "./utils/semver";
import {
	childChoicesOf,
	clearEmptyFormatFlag,
	dedupeChoicesById,
	isChoiceLike,
	resolveChoiceIcon,
	rootChoicesOf,
} from "./utils/choiceUtils";
import {
	choiceCommandId,
	pickDayCommandId,
	pickDayCommandName,
	shouldRegisterPickDayCommand,
} from "./types/choiceCommands";
import { registerQuickAddCliHandlers } from "./cli/registerQuickAddCliHandlers";
import { autoSyncEnabledProviders } from "./ai/modelSyncService";
import { QUICK_ADD_COMMAND_LABELS } from "./commandLabels";
import { PromptPeekSession } from "./gui/promptPeek/PromptPeekSession";
import { ingestImagesIntoActivePrompt as ingestPromptImages } from "./gui/imagePasteHandler";
import { setQuickAddInstance } from "./quickAddInstance";
import { registerQuickAddUri } from "./uri/registerQuickAddUri";
import { registerCoreCommands } from "./plugin/registerCoreCommands";
import { scheduleStartupModelSync } from "./ai/startupModelSync";
import { keepFocusedFieldInView } from "./gui/keepFocusedFieldInView";
import { leaveBuilderPages } from "./gui/ChoiceBuilder/builderPage";
import { registerSaveOnExit } from "./plugin/registerSaveOnExit";
import { actionsFromChoices, choicesFromActions } from "./v3/storage";
import type { StoredSettings } from "./v3/storage";
import type { ActionNode } from "./v3/model";
import { showMigrationReportOnce } from "./gui/MigrationReportModal";

// The settingsStore subscriber fires on every store change — including high-frequency
// ones like folder collapse toggles. Coalesce those full-settings disk writes into one
// per burst (saveData rewrites the whole data.json); flushed on unload so nothing is lost.
const SETTINGS_SAVE_DEBOUNCE_MS = 1000;

export default class QuickAdd extends Plugin {
	settings: QuickAddSettings;
	private unsubscribeSettingsStore: () => void;
	/**
	 * Snapshot of settings as of the last successful load/save, in the shape
	 * data.json stores them. Used as the 3-way-merge base so a whole-file write
	 * cannot clobber newer on-disk fields that this instance never edited (see
	 * #1749 / background model sync).
	 */
	private lastPersistedSettings: StoredSettings | null = null;
	/**
	 * When true, the settingsStore subscriber updates `this.settings` but does
	 * not schedule a disk write. Set while applying a conflict-merge result back
	 * into the store after that result has already been (or is about to be) saved.
	 */
	private suppressSettingsSave = false;
	/**
	 * Set once data.json was handed back to QuickAdd 2 settings: nothing this
	 * instance holds may be written over them.
	 */
	private savingStopped = false;
	/** The ribbon icons of actions shown in the ribbon, and what they were made from. */
	private actionRibbonIcons: { name: string; el: HTMLElement }[] = [];
	private actionRibbonKey = "[]";
	/** Serialize persist calls so overlapping debounced/immediate saves cannot race. */
	private persistChain: Promise<void> = Promise.resolve();
	// Debounced disk write for the store subscriber. saveSettings() stays immediate
	// (migrations await it) and cancels this; onunload flushes it.
	//
	// The async IIFE is load-bearing, not style: floating `saveData()` straight from a
	// non-async arrow leaves NO QuickAdd frame on the rejection's stack (it is
	// constructed inside Obsidian's own FS plumbing, after an await), so a failed
	// settings write would be invisible to the unhandled-rejection reporter - which is
	// the one failure here the user most needs to hear about, since their settings
	// silently did not persist. Awaiting inside a QuickAdd frame puts us on the stack.
	//
	// Not Obsidian's debounce: that schedules on whichever window is active when it is
	// called, so a change made in the Settings popout would be written on the popout's
	// timer, which closing the popout drops. `window` is the main window.
	private pendingSave: number | null = null;
	private requestSave = Object.assign(
		() => {
			this.pendingSave ??= window.setTimeout(
				() => this.requestSave.run(),
				SETTINGS_SAVE_DEBOUNCE_MS,
			);
		},
		{
			run: () => {
				if (this.pendingSave === null) return;
				this.requestSave.cancel();
				void (async () => {
					await this.persistSettings();
				})();
			},
			cancel: () => {
				if (this.pendingSave !== null) window.clearTimeout(this.pendingSave);
				this.pendingSave = null;
			},
		},
	);

	get api(): ReturnType<typeof QuickAddApi.GetApi> {
		return QuickAddApi.GetApi(
			this.app,
			this,
			new ChoiceExecutor(this.app, this),
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
		this.unsubscribeSettingsStore = settingsStore.subscribe((settings) => {
			this.settings = settings;
			// Edits in the builder and settings synced from elsewhere both land here.
			this.refreshActionRibbon();
			if (!this.suppressSettingsSave) {
				this.requestSave();
			}
		});

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
			(name) => this.getChoice("name", name),
			(name) => this.warnIfChoiceNameAmbiguous(name),
		);

		log.register(new ConsoleErrorLogger()).register(new GuiLogger(this));

		// Must come after the loggers: a QuickAdd promise that rejects with nobody
		// awaiting it (a settings click handler, a floated call) used to leave the user
		// with nothing but a console line. Now it reports through the same channel as
		// every other failure (#1576).
		registerUnhandledRejectionReporter(this);
		keepFocusedFieldInView(this);

		if (this.settings.enableRibbonIcon) {
			this.addRibbonIcon("file-plus", "QuickAdd", () => {
				openChoiceLauncher(this);
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
		try {
			await migrate(this);
		} catch (err) {
			reportError(err, "QuickAdd could not run its settings migrations");
		}

		// After the migrations, so commands come from the migrated choices.
		this.addCommandsForChoices(this.settings.choices);
		this.refreshActionRibbon();

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
					this.app,
					this,
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
		this.app.workspace.onLayoutReady(() => void showMigrationReportOnce(this));
	}

	onunload() {
		log.logMessage("Unloading QuickAdd");
		// Leave an open choice builder first, so its edits are in the write below.
		leaveBuilderPages(this.app);
		// Flush any pending debounced settings write so a just-made change (e.g. a
		// folder collapse) is never lost on plugin reload.
		void this.flushPendingSave();
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

		// Stop the interactive-prompt bridge (closes the localhost server and drops
		// any in-flight sessions) so nothing keeps listening after unload.
		interactivePromptServer.stop();
		PromptPeekSession.getActive()?.cancel();
	}

	/**
	 * Normalize raw `data.json` into the in-memory settings shape. Shared by the
	 * initial load and by conflict-aware saves so the 3-way-merge base/disk legs
	 * use the same defaults / coerce / id-heal rules.
	 */
	private normalizeLoadedSettings(loadedData: unknown): QuickAddSettings {
		const settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			choicesFromActions(loadedData) ?? {},
		) as QuickAddSettings & {
			announceUpdates: QuickAddSettings["announceUpdates"] | boolean;
		};

		if (typeof settings.announceUpdates === "boolean") {
			settings.announceUpdates = settings.announceUpdates ? "all" : "none";
		}

		// Heal duplicate choice ids (#1451): a repeated id makes the settings tab's
		// keyed {#each} throw each_key_duplicate and render blank (commands keep
		// working, so it looks like "corrupted data"). Cheap and idempotent, so it
		// runs every load; the next ordinary save rewrites data.json cleaned. No
		// data is lost - see dedupeChoicesById. Only touch a real array: a missing
		// `choices` already defaults to [] via the merge above, and a null/corrupt
		// value is left exactly as-is rather than being silently replaced with []
		// (which a later save would persist, destroying recoverable data).
		if (Array.isArray(settings.choices)) {
			settings.choices = dedupeChoicesById(settings.choices);
		}

		// Runs every load, not as a one-time migration: QuickAdd 2.29 still saves
		// this shape, so a downgrade and a later upgrade can bring it back (#2047).
		walkChoicesInSettings(settings, clearEmptyFormatFlag);

		return settings;
	}

	/**
	 * Settings in the shape data.json stores them. Merges run on this shape,
	 * so once the choices were migrated they merge as actions: what only an
	 * action holds takes part, and steps merge by id.
	 */
	private storedSettings(settings: QuickAddSettings = this.settings): StoredSettings {
		return actionsFromChoices(settings) as StoredSettings;
	}

	/** Raw data.json, normalized as loading does, in the shape data.json stores. */
	private normalizeStoredSettings(loadedData: unknown): StoredSettings {
		return this.storedSettings(this.normalizeLoadedSettings(loadedData));
	}

	async loadSettings() {
		const loadedData = await this.loadData();
		const settings = this.normalizeLoadedSettings(loadedData);
		this.settings = settings;
		// Deep-clone so later in-place store edits cannot mutate the merge base.
		this.lastPersistedSettings = deepClone(this.storedSettings(settings));
	}

	/** Start the pending debounced settings write now. Returns the write. */
	private flushPendingSave(): Promise<void> {
		this.requestSave.run();
		return this.persistChain;
	}

	async saveSettings() {
		// Immediate, awaitable write (migrations rely on this). Supersede any pending
		// debounced write so the same settings aren't redundantly rewritten after.
		this.requestSave.cancel();
		await this.persistSettings();
	}

	/**
	 * Whole-file settings write with a disk-aware merge. If `data.json` changed
	 * since `lastPersistedSettings` (another device/sync, hand edit, …), local
	 * mutations are three-way-merged onto the on-disk value instead of replacing
	 * the file with a stale in-memory snapshot (#1749).
	 *
	 * Obsidian's `loadData` / `saveData` expose no compare-and-swap, file lock, or
	 * version token, so a TOCTOU window remains between the final re-read below
	 * and `saveData`. We narrow that window with a last-look revalidation; we
	 * cannot close it with the public Plugin API alone.
	 */
	private persistSettings(): Promise<void> {
		const run = async () => {
			if (this.savingStopped) return;
			const base = this.lastPersistedSettings;

			const readDisk = async (): Promise<StoredSettings | null> => {
				if (!base) return null;
				return this.normalizeStoredSettings(await this.loadData());
			};

			let disk = await readDisk();

			const buildPlan = (diskSnapshot: StoredSettings | null) => {
				// Capture local AFTER the disk read so updates that landed while
				// loadData() was in flight are included. Nothing runs between
				// this and the merge, so it is also the current store.
				const local = deepClone(this.storedSettings());
				return reconcileSettingsPersistPlan({
					base,
					disk: diskSnapshot,
					local,
					currentStore: local,
				});
			};

			const applyStoreReplace = (
				plan: ReturnType<typeof reconcileSettingsPersistPlan<StoredSettings>>,
			) => {
				if (plan.shouldReplaceStore) this.publishStoredSettings(plan.toWrite);
			};

			let plan = buildPlan(disk);

			if (plan.didMerge) {
				log.logMessage(
					"[Settings] data.json changed on disk since the last QuickAdd write; merged in-memory changes with on-disk settings before saving.",
				);
			}

			applyStoreReplace(plan);

			// Last-look disk revalidation before saveData. Still racy without CAS
			// (see method doc); this only shrinks the window after the first merge.
			if (base) {
				const freshDisk = await readDisk();
				if (
					freshDisk &&
					(!disk || !settingsValuesEqual(freshDisk, disk))
				) {
					log.logMessage(
						"[Settings] data.json changed again before save; re-merging with the fresher on-disk snapshot.",
					);
					disk = freshDisk;
					plan = buildPlan(disk);
					applyStoreReplace(plan);
				}
			}

			// Fold any last-moment store drift onto the planned write, using the
			// plan's local snapshot as the 3-way base so disk-only fields survive.
			const storeAtFinalMerge = deepClone(this.storedSettings());
			let toWrite = plan.toWrite;
			if (!settingsValuesEqual(storeAtFinalMerge, plan.local)) {
				toWrite = threeWayMergeSettings(
					plan.local,
					storeAtFinalMerge,
					plan.toWrite,
				);
			}

			// Keep the live store aligned with what we persist. Otherwise disk-only
			// fields preserved in toWrite stay missing from this.settings, and the
			// next save treats that gap as a local deletion (CodeRabbit on #1750).
			if (
				shouldApplyPersistedWriteToStore(
					toWrite,
					storeAtFinalMerge,
					storeAtFinalMerge,
				)
			) {
				this.publishStoredSettings(toWrite);
			}

			await this.saveData(toWrite);
			// What reading the file back gives: saving canonicalizes the choices.
			this.lastPersistedSettings = this.normalizeStoredSettings(JSON.parse(JSON.stringify(toWrite)));
		};

		this.persistChain = this.persistChain.then(run, run);
		return this.persistChain;
	}

	/**
	 * Obsidian calls this when `data.json` is newer than QuickAdd's last write:
	 * Sync or another sync tool delivered it, another instance on the same
	 * vault wrote it, or someone edited it by hand. Apply it now instead of at
	 * the next reload. Edits made here and not yet saved (the debounced save)
	 * are three-way merged on top, the same way a save merges (#1749). Queued
	 * with the saves so the two never interleave.
	 */
	async onExternalSettingsChange(): Promise<void> {
		const run = async () => {
			if (this.savingStopped) return;
			let loadedData: unknown;
			try {
				loadedData = await this.loadData();
			} catch (err) {
				// A sync client can leave a half-written file behind; the next
				// complete write triggers this again.
				log.logWarning(`QuickAdd could not read its changed settings: ${String(err)}`);
				return;
			}
			// A missing file is not a request to reset every setting.
			if (!loadedData) return;

			const base = this.lastPersistedSettings;
			const disk = this.normalizeStoredSettings(loadedData);
			if (base && settingsValuesEqual(disk, base)) return;

			const local = deepClone(this.storedSettings());
			const merged = base ? threeWayMergeSettings(base, local, disk) : disk;
			this.lastPersistedSettings = deepClone(disk);
			if (!settingsValuesEqual(merged, local)) {
				this.publishStoredSettings(merged);
			}
			if (settingsValuesEqual(merged, disk)) {
				// Everything this instance holds is on disk already.
				this.requestSave.cancel();
			} else {
				// Local edits were merged in; they still need writing.
				this.requestSave();
			}
			log.logMessage("[Settings] Applied settings that changed outside this Obsidian instance.");
		};

		this.persistChain = this.persistChain.then(run, run);
		await this.persistChain;
	}

	/**
	 * Write the data.json copy taken before the QuickAdd 3 migration back over
	 * data.json. This instance saves nothing after that, so the restored file
	 * stays as it was.
	 */
	async restoreV2Snapshot(): Promise<void> {
		const snapshot = this.settings.v3Migration?.snapshot;
		if (!snapshot) throw new Error("QuickAdd has no copy of its settings from before the upgrade.");
		const adapter = this.app.vault.adapter;
		const bytes = await adapter.readBinary(`${this.manifest.dir}/${snapshot}`);
		this.savingStopped = true;
		this.requestSave.cancel();
		// A save already running finishes first; whether it failed does not matter.
		await this.persistChain.catch(() => undefined);
		try {
			await adapter.writeBinary(`${this.manifest.dir}/data.json`, bytes);
		} catch (error) {
			// Nothing was restored, so this instance keeps saving as before.
			this.savingStopped = false;
			throw error;
		}
	}

	/**
	 * Replace the live settings with settings in the shape data.json stores
	 * them, without scheduling a save of them, and bring the choice commands in
	 * line: the choices may have been added, removed or renamed elsewhere.
	 */
	private publishStoredSettings(stored: StoredSettings): void {
		const next = this.normalizeLoadedSettings(deepClone(stored));
		const previousChoices = this.settings.choices;
		this.suppressSettingsSave = true;
		try {
			settingsStore.replaceState(next);
			this.settings = next;
		} finally {
			this.suppressSettingsSave = false;
		}
		if (settingsValuesEqual(previousChoices, next.choices)) return;
		for (const choice of rootChoicesOf(previousChoices)) {
			if (isChoiceLike(choice)) this.removeCommandForChoice(choice, { recursive: true });
		}
		this.addCommandsForChoices(next.choices);
	}

	/**
	 * A ribbon icon for each action shown in the ribbon, with the name and
	 * icon of its choice, that runs it. Rebuilt whenever that list changes.
	 */
	private refreshActionRibbon(): void {
		const items: { id: string; name: string; icon: string }[] = [];
		const walk = (nodes: unknown) => {
			if (!Array.isArray(nodes)) return;
			for (const node of nodes as ActionNode[]) {
				if (node?.kind === "folder") walk(node.items);
				if (node?.kind !== "action" || !node.show?.ribbon) continue;
				const choice = this.getChoice("id", node.id);
				if (choice) items.push({ id: choice.id, name: choice.name, icon: resolveChoiceIcon(choice) });
			}
		};
		walk(this.settings.actions);
		const key = JSON.stringify(items);
		if (key === this.actionRibbonKey) return;
		this.actionRibbonKey = key;

		// Obsidian has no public way to remove a ribbon icon; this is what it
		// runs itself for a plugin's icons when the plugin unloads.
		const ribbon = this.app.workspace.leftRibbon as unknown as { removeRibbonAction?: (id: string) => void };
		for (const { name, el } of this.actionRibbonIcons) {
			ribbon.removeRibbonAction?.(`${this.manifest.id}:${name}`);
			el.detach();
		}
		this.actionRibbonIcons = items.map(({ id, name, icon }) => ({
			name,
			el: this.addRibbonIcon(icon, name, () => this.runRegisteredChoice(id, name)),
		}));
	}

	private addCommandsForChoices(choices: IChoice[]) {
		for (const choice of rootChoicesOf(choices)) {
			// A list entry can be a hole (`null`, a stray primitive) left by a bad
			// edit or a truncated write; it is not a choice, so there is no command
			// to register for it.
			if (!isChoiceLike(choice)) continue;
			// Fault-isolate the loop. This runs from onload against untrusted
			// data.json, and everything after it - migrations, the CLI handlers,
			// startup macros - used to be lost to a single bad choice (#1566: a
			// folder with no `choices` key took the whole plugin down with
			// "Plugin failure: quickadd"). One defect should cost one command.
			try {
				this.addCommandForChoice(choice);
			} catch (err) {
				reportError(err, `Could not add a command for a QuickAdd choice`);
			}
		}
	}

	public addCommandForChoice(choice: IChoice) {
		if (choice.type === "Multi") {
			this.addCommandsForChoices(childChoicesOf(choice));
		}

		if (choice.command) {
			const choiceId = choice.id;

			this.addCommand({
				id: choiceCommandId(choiceId),
				name: choice.name,
				icon: resolveChoiceIcon(choice),
				callback: () => this.runRegisteredChoice(choiceId, choice.name),
			});

			if (
				shouldRegisterPickDayCommand({
					origin: choice.dateOrigin,
					enabled: choice.pickDayCommand,
				})
			) {
				this.addCommand({
					id: pickDayCommandId(choiceId),
					name: pickDayCommandName(choice.name),
					icon: resolveChoiceIcon(choice),
					callback: () =>
						this.runRegisteredChoice(choiceId, choice.name, true),
				});
			}
		}
	}

	private async runRegisteredChoice(
		choiceId: string,
		fallbackName: string,
		pickDate = false,
	): Promise<void> {
		// Resolved outside the try so the failure can name the choice the user
		// actually ran; a bare UUID tells them nothing. Falls back to the name
		// captured at registration when the lookup itself is what failed.
		let current: IChoice | undefined;
		try {
			current = this.getChoiceById(choiceId);
			const executor = new ChoiceExecutor(this.app, this);
			executor.pickDate = pickDate;
			await executor.execute(current);
		} catch (err) {
			// The outermost handler: the last chance to say which choice failed.
			// It reports only what nothing below it already reported (#1601), and
			// stays silent when the user simply dismissed a prompt - Escape on the
			// one-page input modal used to raise a 15-second ERROR notice here.
			reportUnlessCancelled(
				err,
				`Could not run "${current?.name ?? fallbackName}"`,
			);
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
		for (const choice of rootChoicesOf(choices)) {
			if (!isChoiceLike(choice)) continue;
			if (choice[by] === targetPropertyValue) {
				return choice;
			}
			if (choice.type === "Multi") {
				const subChoice = this.getChoice(
					by,
					targetPropertyValue,
					childChoicesOf(choice),
				);
				if (subChoice) {
					return subChoice;
				}
			}
		}

		return null;
	}

	/** Count how many choices anywhere in the tree carry `name` (names aren't unique).
	 * Choices hidden inside an unreadable `choices` value are not counted - the
	 * warning this feeds can only ever under-report, never mis-fire. */
	private countChoicesByName(
		name: string,
		choices: IChoice[] = this.settings.choices,
	): number {
		let count = 0;
		for (const choice of rootChoicesOf(choices)) {
			if (!isChoiceLike(choice)) continue;
			if (choice.name === name) count++;
			if (choice.type === "Multi") {
				count += this.countChoicesByName(name, childChoicesOf(choice));
			}
		}
		return count;
	}

	/** Surface a Notice when a URI's `choice=<name>` is ambiguous, so an automation
	 * that ran the wrong (first-matching) choice is at least diagnosable. */
	private warnIfChoiceNameAmbiguous(name: string): void {
		const matches = this.countChoicesByName(name);
		if (matches > 1) {
			log.logWarning(
				`QuickAdd URI: ${matches} choices are named '${name}'. Ran the first match — rename choices to keep names unique so URIs target the right one.`,
			);
		}
	}

	public removeCommandForChoice(
		choice: IChoice,
		options?: { recursive?: boolean },
	) {
		// Recurse ONLY when the whole subtree is going away (a folder DELETE):
		// a Multi (folder) registers commands for its command-enabled descendants,
		// so tearing it down must remove theirs too, or deleting a folder leaves
		// orphaned palette entries that throw "Choice <id> not found" when invoked.
		//
		// Do NOT recurse when only the folder's OWN command is being removed (e.g.
		// toggling the folder's command off, or the remove half of an update): the
		// children remain and their still-enabled commands must stay registered.
		if (options?.recursive && choice.type === "Multi") {
			for (const child of childChoicesOf(choice)) {
				if (!isChoiceLike(child)) continue;
				this.removeCommandForChoice(child, options);
			}
		}

		this.removeCommand(choiceCommandId(choice.id));
		this.removeCommand(pickDayCommandId(choice.id));
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
