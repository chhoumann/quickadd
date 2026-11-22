import { DEFAULT_SETTINGS, type QuickAddSettings } from "../settings";
import { settingsStore } from "../settingsStore";
import { log } from "../logger/logManager";
import { walkChoicesInSettings } from "../utils/choiceTraversal";
import { clearEmptyFormatFlag, dedupeChoicesById } from "../utils/choiceUtils";
import { deepClone } from "../utils/deepClone";
import {
	reconcileSettingsPersistPlan,
	settingsValuesEqual,
	shouldApplyPersistedWriteToStore,
	threeWayMergeSettings,
} from "../utils/settingsPersistMerge";

// The settingsStore subscriber fires on every store change — including high-frequency
// ones like folder collapse toggles. Coalesce those full-settings disk writes into one
// per burst (saveData rewrites the whole data.json); flushed on unload so nothing is lost.
const SETTINGS_SAVE_DEBOUNCE_MS = 1000;

/** The plugin side of settings persistence. */
export interface SettingsPersistenceHost {
	loadData(): Promise<unknown>;
	saveData(data: unknown): Promise<void>;
	/** The live settings, which the plugin exposes as `plugin.settings`. */
	getSettings(): QuickAddSettings;
	setSettings(settings: QuickAddSettings): void;
	isUnloaded(): boolean;
	/** Settings from disk replaced the live ones, and their choices differ from `previousChoices`. */
	onChoicesReplacedFromDisk(previousChoices: QuickAddSettings["choices"]): void;
}

/**
 * Normalize raw `data.json` into the in-memory settings shape. Shared by the
 * initial load and by conflict-aware saves so the 3-way-merge base/disk legs
 * use the same defaults / coerce / id-heal rules.
 */
export function normalizeLoadedSettings(loadedData: unknown): QuickAddSettings {
	const settings = Object.assign(
		{},
		DEFAULT_SETTINGS,
		loadedData ?? {},
	) as QuickAddSettings & {
		announceUpdates: QuickAddSettings["announceUpdates"] | boolean;
	};

	if (typeof settings.announceUpdates === "boolean") {
		settings.announceUpdates = settings.announceUpdates ? "all" : "none";
	}

	// Heal duplicate choice ids, which blank the settings tab's keyed {#each}.
	// Only touch a real array: a corrupt value stays as-is rather than becoming
	// a [] that a later save would persist.
	if (Array.isArray(settings.choices)) {
		settings.choices = dedupeChoicesById(settings.choices);
	}

	// Runs every load, not as a one-time migration: QuickAdd 2.29 still saves
	// this shape, so a downgrade and a later upgrade can bring it back.
	walkChoicesInSettings(settings, clearEmptyFormatFlag);

	return settings;
}

/**
 * Loads and saves QuickAdd's settings (`data.json`): a debounced write for
 * store changes, an immediate one for callers that await it, a three-way merge
 * with whatever changed on disk since the last write, and applying settings
 * that changed outside this instance.
 */
export class SettingsPersistence {
	/**
	 * Settings as of the last successful load/save: the 3-way-merge base, so a
	 * whole-file write cannot clobber newer on-disk fields this instance never
	 * edited.
	 */
	private lastPersistedSettings: QuickAddSettings | null = null;
	/**
	 * When true, the settingsStore subscriber updates the live settings but does
	 * not schedule a disk write. Set while applying a conflict-merge result back
	 * into the store after that result has already been (or is about to be) saved.
	 */
	private suppressSettingsSave = false;
	/**
	 * Serialize persist calls so overlapping debounced/immediate saves cannot
	 * race. Null when nothing is queued, so quit can tell there is nothing to
	 * wait for.
	 */
	private persistChain: Promise<void> | null = null;
	// Debounced disk write for the store subscriber; saveNow() stays immediate and
	// cancels it. The async IIFE keeps a QuickAdd frame on a failed write's stack,
	// so the unhandled-rejection reporter sees it. `window` rather than Obsidian's
	// debounce, which schedules on the active window: closing a popout drops its
	// timer.
	private pendingSave: number | null = null;
	readonly requestSave = Object.assign(
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

	constructor(private readonly host: SettingsPersistenceHost) {}

	async load(): Promise<void> {
		const settings = normalizeLoadedSettings(await this.host.loadData());
		this.host.setSettings(settings);
		// Deep-clone so later in-place store edits cannot mutate the merge base.
		this.lastPersistedSettings = deepClone(settings);
	}

	/** The settingsStore subscriber: take the new settings and schedule their write. */
	onStoreChange(settings: QuickAddSettings): void {
		this.host.setSettings(settings);
		if (!this.suppressSettingsSave) {
			this.requestSave();
		}
	}

	/**
	 * Start the pending debounced settings write now. Returns the queued
	 * settings work, or null when there is none to wait for.
	 */
	flushPendingSave(): Promise<void> | null {
		this.requestSave.run();
		return this.persistChain;
	}

	/** Immediate, awaitable write (migrations rely on this). */
	async saveNow(): Promise<void> {
		// Supersede any pending debounced write so the same settings aren't
		// redundantly rewritten after.
		this.requestSave.cancel();
		await this.persistSettings();
	}

	private queuePersistRun(run: () => Promise<void>): Promise<void> {
		const chain: Promise<void> = (this.persistChain ?? Promise.resolve())
			.then(run, run)
			.finally(() => {
				if (this.persistChain === chain) this.persistChain = null;
			});
		this.persistChain = chain;
		return chain;
	}

	/**
	 * Whole-file settings write with a disk-aware merge. If `data.json` changed
	 * since `lastPersistedSettings` (another device/sync, hand edit, …), local
	 * mutations are three-way-merged onto the on-disk value instead of replacing
	 * the file with a stale in-memory snapshot.
	 *
	 * Obsidian's `loadData` / `saveData` expose no compare-and-swap, file lock, or
	 * version token, so a TOCTOU window remains between the final re-read below
	 * and `saveData`. We narrow that window with a last-look revalidation; we
	 * cannot close it with the public Plugin API alone.
	 */
	private persistSettings(): Promise<void> {
		const run = async () => {
			const base = this.lastPersistedSettings;

			const readDisk = async (): Promise<QuickAddSettings | null> => {
				if (!base) return null;
				return normalizeLoadedSettings(await this.host.loadData());
			};

			let disk = await readDisk();

			const buildPlan = (diskSnapshot: QuickAddSettings | null) => {
				// Capture local AFTER the disk read so updates that landed while
				// loadData() was in flight are included, then fold any further
				// live-store drift onto that plan.
				const local = deepClone(this.host.getSettings());
				return reconcileSettingsPersistPlan({
					base,
					disk: diskSnapshot,
					local,
					currentStore: this.host.getSettings(),
				});
			};

			const applyStoreReplace = (
				plan: ReturnType<typeof reconcileSettingsPersistPlan<QuickAddSettings>>,
			) => {
				if (
					plan.shouldReplaceStore &&
					settingsValuesEqual(this.host.getSettings(), plan.local)
				) {
					this.publishSettingsFromDisk(plan.toWrite);
				}
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
			const storeAtFinalMerge = deepClone(this.host.getSettings());
			let toWrite = plan.toWrite;
			if (!settingsValuesEqual(storeAtFinalMerge, plan.local)) {
				toWrite = threeWayMergeSettings(
					plan.local,
					storeAtFinalMerge,
					plan.toWrite,
				);
			}

			// Keep the live store aligned with what we persist, or disk-only fields
			// missing from it would read as a local deletion on the next save.
			if (
				shouldApplyPersistedWriteToStore(
					toWrite,
					this.host.getSettings(),
					storeAtFinalMerge,
				)
			) {
				this.publishSettingsFromDisk(toWrite);
			}

			await this.host.saveData(toWrite);
			this.lastPersistedSettings = deepClone(toWrite);
		};

		return this.queuePersistRun(run);
	}

	/**
	 * Obsidian calls this when `data.json` is newer than QuickAdd's last write:
	 * Sync or another sync tool delivered it, another instance on the same
	 * vault wrote it, or someone edited it by hand. Apply it now instead of at
	 * the next reload. Edits made here and not yet saved (the debounced save)
	 * are three-way merged on top, the same way a save merges. Queued
	 * with the saves so the two never interleave.
	 */
	async onExternalSettingsChange(): Promise<void> {
		const run = async () => {
			let loadedData: unknown;
			try {
				loadedData = await this.host.loadData();
			} catch (err) {
				// A sync client can leave a half-written file behind; the next
				// complete write triggers this again.
				log.logWarning(`QuickAdd could not read its changed settings: ${String(err)}`);
				return;
			}
			// A missing file is not a request to reset every setting.
			if (!loadedData) return;
			// The next instance reads the file itself. A save that unload flushed
			// is queued behind this run and merges with disk on its own.
			if (this.host.isUnloaded()) return;

			const base = this.lastPersistedSettings;
			const disk = normalizeLoadedSettings(loadedData);
			if (base && settingsValuesEqual(disk, base)) return;

			const merged = base
				? threeWayMergeSettings(base, deepClone(this.host.getSettings()), disk)
				: disk;
			this.lastPersistedSettings = deepClone(disk);
			if (!settingsValuesEqual(merged, this.host.getSettings())) {
				this.publishSettingsFromDisk(merged);
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

		await this.queuePersistRun(run);
	}

	/**
	 * Replace the live settings with values that came from disk, without
	 * scheduling a save of them, and tell the host when the choices changed:
	 * they may have been added, removed or renamed elsewhere.
	 */
	private publishSettingsFromDisk(next: QuickAddSettings): void {
		const previousChoices = this.host.getSettings().choices;
		this.suppressSettingsSave = true;
		try {
			settingsStore.replaceState(next);
			this.host.setSettings(next);
		} finally {
			this.suppressSettingsSave = false;
		}
		if (settingsValuesEqual(previousChoices, next.choices)) return;
		this.host.onChoicesReplacedFromDisk(previousChoices);
	}
}
