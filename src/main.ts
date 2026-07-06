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
import { reportError, withErrorHandling } from "./utils/errorUtils";
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
import { interactivePromptServer } from "./interactive/interactivePromptServer";
import { parseSemver } from "./utils/semver";
import { dedupeChoicesById, resolveChoiceIcon } from "./utils/choiceUtils";
import { isReservedVariableKey } from "./utils/reservedVariableKeys";
import { registerQuickAddCliHandlers } from "./cli/registerQuickAddCliHandlers";
import { autoSyncEnabledProviders } from "./ai/modelSyncService";
import { QUICK_ADD_COMMAND_LABELS } from "./commandLabels";
import { setQuickAddInstance } from "./quickAddInstance";
import { applyTemplateToNote } from "./engine/applyTemplateToActiveNote";
import type ITemplateChoice from "./types/choices/ITemplateChoice";
import type ICaptureChoice from "./types/choices/ICaptureChoice";
import {
	buildCallbackUrl,
	buildObsidianOpenUrl,
	callbackUrls,
	isCallbackUrlAllowed,
	parseCallbackTargets,
	type CallbackTargets,
} from "./uri/uriCallback";
import { runTemplateFromFolder } from "./engine/runTemplateFromFolder";

// Parameters prefixed with `value-` get used as named values for the executed choice
type CaptureValueParameters = { [key in `value-${string}`]?: string };

interface DefinedUriParameters {
	choice?: string; // Name
}

// x-callback-url parameters (Apple Shortcuts, etc.). The hyphenated keys arrive
// verbatim from the obsidian:// query string.
interface XCallbackParameters {
	"x-success"?: string;
	"x-error"?: string;
	"x-cancel"?: string;
	"x-callback-url"?: string;
}

type UriParameters = DefinedUriParameters &
	CaptureValueParameters &
	XCallbackParameters;

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
				ChoiceSuggester.Open(this, this.settings.choices, {
					includeTemplateFolderRow: true,
				});
			},
		});

		this.addCommand({
			id: "runTemplateFromFolder",
			name: QUICK_ADD_COMMAND_LABELS.runTemplateFromFolder,
			callback: () => {
				void runTemplateFromFolder(this.app, this, {
					choiceExecutor: new ChoiceExecutor(this.app, this),
				});
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
						// Aligns with the command-palette label
						// (QUICK_ADD_COMMAND_LABELS.applyTemplate) so the same action reads
						// consistently across both surfaces. Obsidian prefixes commands with
						// "QuickAdd:"; the file menu is unprefixed, so add it here.
						.setTitle(`QuickAdd: ${QUICK_ADD_COMMAND_LABELS.applyTemplate}`)
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

			// Resolve callback targets only when the feature is enabled. With it off (or
			// no x-* params) we run the exact legacy path — zero behavioural change.
			const targets: CallbackTargets = this.settings.enableUriCallbacks
				? parseCallbackTargets(parameters)
				: { any: false };

			if (!targets.any) {
				await this.runUriChoiceLegacy(parameters);
				return;
			}

			// Validate every provided callback URL BEFORE running anything, so a bad URL
			// can't half-execute and make an external caller retry (and duplicate work).
			const disallowed = callbackUrls(targets).filter(
				(url) => !isCallbackUrlAllowed(url),
			);
			if (disallowed.length > 0) {
				log.logWarning(
					`QuickAdd URI: ignoring disallowed callback URL(s): ${disallowed.join(", ")}`,
				);
				// Notify via x-error only if it is itself allowed; never open a disallowed
				// URL. Nothing was executed, so the caller can safely retry.
				if (targets.error && isCallbackUrlAllowed(targets.error)) {
					this.openUriCallback(targets.error, {
						status: "error",
						errorCode: "bad-callback-url",
					});
				}
				return;
			}

			if (!parameters.choice) {
				log.logWarning("URI was executed without a `choice` parameter.");
				this.fireUriError(targets, "choice-not-found");
				return;
			}

			const choice = this.getChoice("name", parameters.choice);
			if (!choice) {
				log.logWarning(
					`URI could not find any choice named '${parameters.choice}'`,
				);
				this.fireUriError(targets, "choice-not-found");
				return;
			}

			// Names are not unique; getChoice returns the FIRST match. Warn so an
			// ambiguous target is diagnosable rather than silently running the wrong one.
			this.warnIfChoiceNameAmbiguous(parameters.choice);

			if (choice.type !== "Template" && choice.type !== "Capture") {
				log.logWarning(
					`QuickAdd URI x-callback supports Template and Capture choices only ('${choice.name}' is ${choice.type}). ` +
						`A URI with x-* callback params cannot run a ${choice.type} choice while "Enable URI callbacks" is on; remove the x-* params to run it on the legacy path.`,
				);
				this.fireUriError(targets, "unsupported-choice-type");
				return;
			}

			const choiceExecutor = new ChoiceExecutor(this.app, this);
			this.applyUriValueParameters(choiceExecutor, parameters);

			const outcome = await choiceExecutor.executeWithOutcome(
				choice as ITemplateChoice | ICaptureChoice,
			);

			switch (outcome.status) {
				case "success":
					this.fireUriSuccess(targets, outcome.file);
					break;
				case "cancelled":
					if (outcome.cancelKind === "user") {
						this.fireUriCancel(targets);
					} else {
						this.fireUriError(targets, "execution-aborted");
					}
					break;
				case "error":
					this.fireUriError(targets, "execution-failed");
					break;
			}
		});

		log.register(new ConsoleErrorLogger()).register(new GuiLogger(this));

		if (this.settings.enableRibbonIcon) {
			this.addRibbonIcon("file-plus", "QuickAdd", () => {
				ChoiceSuggester.Open(this, this.settings.choices, {
					includeTemplateFolderRow: true,
				});
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

		// Keep AI provider model lists current without plugin releases: a quiet,
		// daily-throttled background sync for providers that opted in. Deferred
		// past layout-ready so it never competes with startup work.
		this.app.workspace.onLayoutReady(() => {
			window.setTimeout(() => {
				void autoSyncEnabledProviders(this.app);
			}, 5_000);
		});

		this.announceUpdate();
	}

	/** Today's URI behaviour: run the choice, report errors to the log. Used when URI
	 * callbacks are disabled or no x-* params were provided (backward-compatible). */
	private async runUriChoiceLegacy(parameters: UriParameters): Promise<void> {
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
		// Choice names are not unique; getChoice returns the FIRST match. Warn the user
		// (via Notice) when the name is ambiguous so an automation that silently ran the
		// wrong choice is at least diagnosable.
		this.warnIfChoiceNameAmbiguous(parameters.choice);
		const choiceExecutor = new ChoiceExecutor(this.app, this);
		this.applyUriValueParameters(choiceExecutor, parameters);
		try {
			await choiceExecutor.execute(choice);
		} catch (err) {
			reportError(err, "Error executing choice from URI");
		}
	}

	private applyUriValueParameters(
		choiceExecutor: ChoiceExecutor,
		parameters: UriParameters,
	): void {
		Object.entries(parameters)
			.filter(([key]) => key.startsWith("value-"))
			.forEach(([key, value]) => {
				const variableName = key.slice(6);
				// Never let an incoming URI populate a reserved internal variable
				// (e.g. the capture-target file path): obsidian:// links are reachable
				// by any webpage/app, so honouring `value-__qa.…` would let an external
				// caller drive internal plumbing. There is no legitimate URI use for
				// these keys.
				if (
					variableName &&
					typeof value === "string" &&
					!isReservedVariableKey(variableName)
				) {
					choiceExecutor.variables.set(variableName, value);
				}
			});
	}

	private fireUriSuccess(targets: CallbackTargets, file?: TFile): void {
		const params: Record<string, string> = { status: "success" };
		if (file) {
			params.path = file.path;
			params.url = buildObsidianOpenUrl(this.app.vault.getName(), file.path);
		}
		if (targets.success) this.openUriCallback(targets.success, params);
	}

	private fireUriError(targets: CallbackTargets, errorCode: string): void {
		if (targets.error) {
			this.openUriCallback(targets.error, { status: "error", errorCode });
		}
	}

	private fireUriCancel(targets: CallbackTargets): void {
		if (targets.cancel) {
			this.openUriCallback(targets.cancel, { status: "cancel" });
		}
	}

	/** Opens a callback URL with the result params appended. No-throw, no-recursion:
	 * a failed window.open must never break the (already-completed) choice or fire
	 * another callback. */
	private openUriCallback(url: string, params: Record<string, string>): void {
		withErrorHandling(() => {
			window.open(buildCallbackUrl(url, params));
		}, "QuickAdd URI: failed to open callback URL");
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

		// Stop the interactive-prompt bridge (closes the localhost server and drops
		// any in-flight sessions) so nothing keeps listening after unload.
		interactivePromptServer.stop();
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

	/** Count how many choices anywhere in the tree carry `name` (names aren't unique). */
	private countChoicesByName(
		name: string,
		choices: IChoice[] = this.settings.choices,
	): number {
		let count = 0;
		for (const choice of choices) {
			if (choice.name === name) count++;
			if (choice.type === "Multi") {
				count += this.countChoicesByName(
					name,
					(choice as IMultiChoice).choices,
				);
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
			for (const child of (<IMultiChoice>choice).choices) {
				this.removeCommandForChoice(child, options);
			}
		}

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
