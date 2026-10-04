import type {
	App,
	ButtonComponent,
	Setting,
	SettingDefinitionGroup,
	SettingDefinitionItem,
	SettingDefinitionList,
	TextAreaComponent,
} from "obsidian";
import { Notice, PluginSettingTab } from "obsidian";
import type QuickAdd from "./main";
import type IChoice from "./types/choices/IChoice";
import ChoiceView from "./gui/choiceList/ChoiceView.svelte";
import ChoicesUnavailable from "./gui/choiceList/ChoicesUnavailable.svelte";
import { mountComponent, type MountHandle } from "./gui/svelte/mountComponent";
import type { Plain } from "./gui/svelte/persist.svelte";
import GenericSuggester from "./gui/GenericSuggester/genericSuggester";
import GlobalVariablesView from "./gui/GlobalVariables/GlobalVariablesView.svelte";
import RunLogView from "./gui/RunLog/RunLogView.svelte";
import { settingsStore } from "./settingsStore";
import { getAllFolderPathsInVault } from "./utils/vaultQueries";
import { normalizeTemplateFolderPaths } from "./utils/templateFolderUtils";
import { sortFolderPathsByTree } from "./utils/folder-sorting";
import { ExportPackageModal } from "./gui/PackageManager/ExportPackageModal";
import { ImportPackageModal } from "./gui/PackageManager/ImportPackageModal";
import { syncImportedChoiceCommands } from "./services/packageImportCommands";
import { InputPromptDraftStore } from "./utils/InputPromptDraftStore";
import type { QuickAddSettings } from "./settings";
import {
	DEFAULT_DATE_ALIASES,
	formatDateAliasLines,
	parseDateAliasLines,
} from "./utils/dateAliases";
import { renderDevelopmentInfo } from "./quickAddSettingsDevelopmentInfo";
import { DOCS_URLS } from "./docs";
import {
	createSettingDefinitions,
	descWithDocsLink,
	PACKAGES_DESC,
	type SettingsKey,
} from "./gui/components/settingsDefinitions";
import { rootChoicesOf } from "./utils/choiceUtils";
import { ensureProviderIds } from "./ai/Provider";
import {
	AI_ASSISTANT_PAGE_NAME,
	aiPageSignature,
	createAIAssistantPage,
} from "./gui/ai/aiAssistantSettingsPage";
import { openQuickAddSettings, tryOpenSettingsPage, closeSettings, tryOpenPluginSettings } from "./utils/openPluginSettings";
import { storedProviders } from "./gui/ai/aiSettingsState";
import { isCancellationError } from "./utils/errorUtils";
import { confirmAction } from "./gui/confirmAction";

const AI_KEY_PREFIX = "ai.";

export class QuickAddSettingsTab extends PluginSettingTab {
	public plugin: QuickAdd;
	/**
	 * The choice list, kept mounted while the tab is shown. Obsidian tears the
	 * tab down when a settings page opens over it (a choice's settings) and
	 * renders it again when the page is left. Mounting the list again took
	 * ~300 ms with 300 choices, and cleared its filter and the control that
	 * opened the page, so the new row gets the same list instead.
	 */
	private choiceView: { el: HTMLElement; handle: MountHandle } | null = null;
	/** The Svelte views mounted in rows other than the choice list, by row. */
	private readonly mountedViews = new Map<string, MountHandle>();
	/** Live store subscription behind the Packages row's Export state. */
	private packagesUnsubscribe: (() => void) | null = null;

	constructor(app: App, plugin: QuickAdd) {
		super(app, plugin);
		this.plugin = plugin;
		this.icon = "zap";

		// The AI pages address providers by id. Migrations assign ids, but a
		// hand-edited data.json can still hold a provider without one, or two
		// providers claiming the same one.
		const withIds = storedProviders().map((provider) => ({ ...provider }));
		if (ensureProviderIds(withIds)) {
			settingsStore.setState((state) => ({
				ai: { ...state.ai, providers: withIds },
			}));
		}

		// Declarative definitions are a snapshot: Obsidian re-renders from them
		// until update() rebuilds them. Rebuild when the AI page's provider
		// entries, the template folder list or the QuickAdd 2 copy change (the
		// way Obsidian's own Keychain tab follows its secrets), but not on every
		// store write: update() re-renders the page on screen.
		const definitionsSignature = (state: QuickAddSettings): string =>
			JSON.stringify([
				aiPageSignature(storedProviders(state)),
				normalizeTemplateFolderPaths(state.templateFolderPaths),
				state.v3Migration?.snapshot,
			]);
		let signature = definitionsSignature(settingsStore.getState());
		plugin.register(
			settingsStore.subscribe((state) => {
				const next = definitionsSignature(state);
				if (next === signature) return;
				signature = next;
				this.update();
			}),
		);
	}

	/**
	 * The "Open AI Assistant settings" command: open the settings window on
	 * this tab, then the AI Assistant page. The page is hidden while AI and
	 * online features are off, so say so instead of showing it anyway.
	 */
	openAIAssistantPageFromCommand(): void {
		if (settingsStore.getState().disableOnlineFeatures) {
			new Notice(
				"QuickAdd: Turn off “Disable AI & online features” in QuickAdd settings to use the AI Assistant.",
			);
			return;
		}
		if (!openQuickAddSettings(this.app, this.plugin.manifest.id)) return;
		this.openAIAssistantPage();
	}

	/**
	 * Settings → QuickAdd → AI Assistant, for the choice list's "Configure AI
	 * Assistant" buttons, which live on this tab.
	 */
	openAIAssistantPage(): void {
		if (!tryOpenSettingsPage(this.app, this, [AI_ASSISTANT_PAGE_NAME])) {
			new Notice(
				`QuickAdd: Open the ${AI_ASSISTANT_PAGE_NAME} page under "AI & online" below.`,
			);
		}
	}

	// -----------------------------------------------------------------------
	// Store bridge
	//
	// QuickAdd's single source of truth is the zustand `settingsStore`, and the
	// only persistence path is the subscriber installed in main.ts (which sets
	// `plugin.settings` and calls `saveSettings()` on every store change). The
	// declarative `control` API would otherwise bind directly to
	// `plugin.settings[key]` and call `saveData` itself, bypassing the store and
	// leaving every live store consumer (formatter, dateParser, choiceExecutor,
	// the AI command, the Svelte views, ...) stale. Overriding both accessors to
	// read/write the store keeps it authoritative. We must NOT also touch
	// `plugin.settings` or call `saveData` here — the subscriber owns that.
	// -----------------------------------------------------------------------

	override getControlValue(key: string): unknown {
		const state = settingsStore.getState();

		if (key.startsWith(AI_KEY_PREFIX)) {
			const field = key.slice(AI_KEY_PREFIX.length);
			return state.ai[field as keyof QuickAddSettings["ai"]];
		}

		// `inputPrompt` is stored as an enum but surfaced as a boolean toggle.
		if (key === "inputPrompt") {
			return state.inputPrompt === "multi-line";
		}

		return state[key as keyof QuickAddSettings];
	}

	override setControlValue(key: string, value: unknown): void {
		if (key.startsWith(AI_KEY_PREFIX)) {
			const field = key.slice(AI_KEY_PREFIX.length);
			settingsStore.setState((state) => ({
				ai: { ...state.ai, [field]: value },
			}));
			return;
		}

		if (key === "inputPrompt") {
			settingsStore.setState({
				inputPrompt: value ? "multi-line" : "single-line",
			});
			return;
		}

		if (key === "persistInputPromptDrafts") {
			const enabled = Boolean(value);
			settingsStore.setState({ persistInputPromptDrafts: enabled });
			if (!enabled) {
				InputPromptDraftStore.getInstance().clearAll();
			}
			return;
		}

		settingsStore.setState({ [key]: value } as Partial<QuickAddSettings>);
	}

	override getSettingDefinitions(): SettingDefinitionItem<SettingsKey>[] {
		return createSettingDefinitions({
			choices: (setting) => this.renderChoicesView(setting),
			packages: (setting) => this.renderPackages(setting),
			dateAliases: (setting) => this.renderDateAliases(setting),
			globalVariables: (setting) => this.renderGlobalVariablesView(setting),
			runLog: (setting) => this.renderRunLogView(setting),
			developmentInfo: (setting) => this.renderDevInfo(setting),
		}, __IS_DEV_BUILD__, createAIAssistantPage(this.app), this.templateFoldersList(), this.v2SettingsGroup());
	}

	/** Undo or redo the QuickAdd 3 migration from the copy of data.json taken before it. */
	private v2SettingsGroup(): SettingDefinitionGroup<SettingsKey> | undefined {
		const snapshot = settingsStore.getState().v3Migration?.snapshot;
		if (!snapshot) return undefined;
		const id = this.plugin.manifest.id;
		const plugins = this.app.plugins;
		return {
			type: "group",
			heading: "QuickAdd 2 settings",
			items: [
				{
					name: "Restore QuickAdd 2 settings",
					action: () => void (async () => {
						const confirmed = await confirmAction(this.app, {
							title: "Restore QuickAdd 2 settings?",
							message: `QuickAdd replaces its settings with the copy in ${snapshot} from before the upgrade and turns itself off. Every change since the upgrade is lost. Install QuickAdd 2 to use the restored settings.`,
							action: "Restore and turn off",
						});
						if (!confirmed) return;
						await this.plugin.restoreV2Snapshot();
						await plugins.disablePluginAndSave(id);
						// The tab is gone with the plugin; an empty pane would be left behind.
						closeSettings(this.app);
						new Notice("QuickAdd restored its QuickAdd 2 settings and turned itself off.");
					})(),
				},
				{
					name: "Migrate again from QuickAdd 2 settings",
					action: () => void (async () => {
						const confirmed = await confirmAction(this.app, {
							title: "Migrate again?",
							message: `QuickAdd replaces its settings with the copy in ${snapshot} from before the upgrade and migrates them again. Every change since the upgrade is lost.`,
							action: "Migrate again",
						});
						if (!confirmed) return;
						await this.plugin.restoreV2Snapshot();
						await plugins.disablePlugin(id);
						await plugins.enablePlugin(id);
						// The new instance registers its own tab; show it where this one was.
						tryOpenPluginSettings(this.app, id);
					})(),
				},
			],
		};
	}

	private templateFoldersList(): SettingDefinitionGroup<SettingsKey> | SettingDefinitionList<SettingsKey> {
		const paths = templateFolderPaths();
		const addFolder = { name: "Add folder", action: () => void this.addTemplateFolder() };
		// Settings search indexes items, not a list's heading or empty state, so
		// with no folder the section is an "Add folder" row that search can find.
		// It is a group, not an empty list: Obsidian re-renders a section in place
		// when its type and heading stay the same, and would keep the list's +.
		const aliases = ["Template folders"];
		if (paths.length === 0) {
			return {
				type: "group",
				heading: "Template folders",
				items: [{
					...addFolder,
					desc: "No folders yet. QuickAdd suggests templates from the whole vault.",
					aliases,
				}],
			};
		}
		return {
			type: "list",
			heading: "Template folders",
			addItem: addFolder,
			onDelete: (index) => {
				settingsStore.setState({
					templateFolderPaths: templateFolderPaths().filter(
						(folder) => folder !== paths[index],
					),
				});
			},
			items: paths.map((folder) => ({ name: folder, aliases })),
		};
	}

	private async addTemplateFolder(): Promise<void> {
		const added = new Set(templateFolderPaths());
		const folders = sortFolderPathsByTree(getAllFolderPathsInVault(this.app))
			.filter((path) => path !== "/" && !added.has(path));
		let folder: string;
		try {
			folder = await GenericSuggester.Suggest(
				this.app,
				folders,
				folders,
				"Choose a template folder",
			);
		} catch (error) {
			if (isCancellationError(error)) return;
			throw error;
		}
		const paths = templateFolderPaths();
		if (paths.includes(folder)) return;
		settingsStore.setState({ templateFolderPaths: [...paths, folder] });
	}

	override hide(): void {
		// In declarative mode the framework owns row teardown — unloading the
		// control Components and running each render def's cleanup closure —
		// which the base hide() drives. We must call it (the old imperative tab
		// emptied containerEl itself, so the missing super.hide() was harmless
		// then; it is not now). destroySettingViews() is the idempotent safety
		// net for the two Svelte mounts.
		super.hide();
		this.destroySettingViews();
	}

	private destroySettingViews(): void {
		this.choiceView?.handle.destroy();
		this.choiceView = null;
		for (const handle of this.mountedViews.values()) handle.destroy();
		this.mountedViews.clear();
		// Safety net for the Packages subscription: the render cleanup already
		// unsubscribes, but this row outlives no view of its own, so a missed
		// cleanup would leak a listener for the plugin's lifetime.
		this.packagesUnsubscribe?.();
		this.packagesUnsubscribe = null;
	}

	/** Strip the label/description column and let a row span the full width —
	 * used to host the mounted Svelte views. The declarative API requires a
	 * `name` on every definition (for search indexing); we set it on the def and
	 * remove the rendered `infoEl` here so the view still spans full width. */
	private prepareFullWidthSetting(setting: Setting): void {
		setting.infoEl.remove();
		setting.settingEl.addClass("qa-setting-full-width");
		setting.controlEl.addClass("qa-setting-full-width-control");
	}

	// The declarative framework builds every group by calling these `render`
	// closures in turn, so a throw out of one of them abandons the rest: when
	// ChoiceView's mount threw, QuickAdd's settings came up as a lone "Choices &
	// packages" heading with nothing under it, and no other section rendered at
	// all (#1451, #1507, #1566). That guard now lives in mountComponent itself, so
	// every Svelte host in the plugin gets it (#1584) — here we only choose which
	// card takes the view's place.
	//
	// ChoiceView has its own <svelte:boundary> for reactive failures inside the
	// list; mountComponent catches the setup that boundary sits inside.

	private mountView(
		setting: Setting,
		row: string,
		mount: (target: HTMLElement) => MountHandle,
	): () => void {
		this.prepareFullWidthSetting(setting);
		this.mountedViews.get(row)?.destroy();
		const handle = mount(setting.controlEl);
		this.mountedViews.set(row, handle);
		// A stale row cleanup must never destroy or clear its replacement.
		return () => {
			handle.destroy();
			if (this.mountedViews.get(row) === handle) this.mountedViews.delete(row);
		};
	}

	private renderChoicesView(setting: Setting): () => void {
		this.prepareFullWidthSetting(setting);
		if (!this.choiceView) {
			const el = createDiv();
			const handle = this.mountChoiceView(el);
			// A failed mount shows its card; try again on the next render.
			if (!handle.ok) {
				setting.controlEl.appendChild(el);
				return () => handle.destroy();
			}
			this.choiceView = { el, handle };
		}
		const { el } = this.choiceView;
		setting.controlEl.appendChild(el);
		return () => el.remove();
	}

	private mountChoiceView(target: HTMLElement): MountHandle {
		return mountComponent(
			target,
			ChoiceView,
			{
				app: this.app,
				plugin: this.plugin,
				choices: settingsStore.getState().choices,
				// Typed Plain<IChoice[]> (not IChoice[]) so a forgotten $state.snapshot at
				// the call site is a COMPILE error here — this is the real persistence sink
				// that must never receive a live Svelte $state proxy. Plain<T> is assignable
				// to T, so setState still accepts it.
				saveChoices: (choices: Plain<IChoice[]>) => {
					settingsStore.setState({ choices });
				},
				openAISettings: () => this.openAIAssistantPage(),
			},
			// The choice list is the one view whose failure has a recovery story worth
			// spelling out (the data.json advice in ChoicesUnavailable), and the same
			// card the view itself shows when the tree is unreadable — so a mount
			// failure and a render failure look identical to the user.
			{ what: "your choices", fallbackComponent: ChoicesUnavailable },
		);
	}

	private renderRunLogView(setting: Setting): () => void {
		return this.mountView(setting, "runLog", (target) =>
			mountComponent(target, RunLogView, { app: this.app }, { what: "the run log" }),
		);
	}

	private renderGlobalVariablesView(setting: Setting): () => void {
		return this.mountView(setting, "globalVariables", (target) =>
			mountComponent(
				target,
				GlobalVariablesView,
				{
					app: this.app,
					plugin: this.plugin,
				},
				{ what: "your global variables" },
			),
		);
	}

	/** Packages description, with the reason Export is unavailable when it is. */
	private packagesDesc(hasNothingToExport: boolean): DocumentFragment {
		return descWithDocsLink(
			hasNothingToExport
				? `${PACKAGES_DESC} Export becomes available once you have a choice. `
				: `${PACKAGES_DESC} `,
			DOCS_URLS.packages,
			"Learn more about packages",
		);
	}

	private renderPackages(setting: Setting): () => void {
		// Both package actions are secondary utilities — not the page's primary
		// action ("New choice" is) — so neither is a CTA. Keeping only one filled
		// primary button in the view avoids competing purple CTAs (per the
		// one-primary-button-per-page rule).
		let exportButton: ButtonComponent | undefined;
		setting.addButton((button) => {
			exportButton = button;
			button.setButtonText("Export package…").onClick(() => {
				const choicesSnapshot = rootChoicesOf(
					settingsStore.getState().choices,
				);
				new ExportPackageModal(
					this.app,
					this.plugin,
					choicesSnapshot,
				).open();
			});
		});

		// Import stays available with zero choices on purpose: importing a package
		// is one of the most useful things a brand-new user can do, so the block as
		// a whole is not de-emphasised, only the action that cannot work.
		setting.addButton((button) =>
			button.setButtonText("Import package…").onClick(() => {
				new ImportPackageModal(this.app, {
					onImported: (result, previousChoices) =>
						syncImportedChoiceCommands(this.plugin, previousChoices, result),
				}).open();
			}),
		);

		// "Export package…" used to be the first concrete action a new user saw
		// below the "No choices yet" empty state, with nothing to export (issue
		// #1547). The tooltip covers desktop hover; the description carries the
		// same reason for touch, where there is no hover, and for screen readers.
		const apply = (hasNothingToExport: boolean): void => {
			setting.setDesc(this.packagesDesc(hasNothingToExport));
			if (!exportButton) return;
			exportButton.setDisabled(hasNothingToExport);
			if (hasNothingToExport) {
				exportButton.setTooltip("Nothing to export yet");
			} else {
				// setTooltip("") is unspecified; Obsidian's tooltip is driven by
				// aria-label, so drop the attribute outright.
				exportButton.buttonEl.removeAttribute("aria-label");
			}
		};

		// The declarative tab renders once and does NOT re-render on store changes,
		// so subscribe to keep the state honest while the tab stays open.
		let hasNothingToExport =
			rootChoicesOf(settingsStore.getState().choices).length === 0;
		apply(hasNothingToExport);

		this.packagesUnsubscribe?.();
		const unsubscribe = settingsStore.subscribe((settings) => {
			const next = rootChoicesOf(settings.choices).length === 0;
			if (next === hasNothingToExport) return;
			hasNothingToExport = next;
			apply(next);
		});
		this.packagesUnsubscribe = unsubscribe;

		return () => {
			unsubscribe();
			if (this.packagesUnsubscribe === unsubscribe) {
				this.packagesUnsubscribe = null;
			}
		};
	}

	private renderDateAliases(setting: Setting): void {
		setting.settingEl.addClass("qa-date-alias-setting");
		setting.controlEl.addClass("qa-date-alias-control");

		let textAreaRef: TextAreaComponent | null = null;

		setting.addTextArea((textArea) => {
			textAreaRef = textArea;
			textArea
				.setPlaceholder("t = today\ntm = tomorrow\nyd = yesterday")
				.setValue(
					formatDateAliasLines(settingsStore.getState().dateAliases),
				)
				.onChange((value) => {
					settingsStore.setState({
						dateAliases: parseDateAliasLines(value),
					});
				});
			textArea.inputEl.addClass("qa-date-alias-input");
		});

		setting.addButton((button) => {
			button.setButtonText("Reset to defaults").onClick(() => {
				settingsStore.setState({ dateAliases: DEFAULT_DATE_ALIASES });
				textAreaRef?.setValue(formatDateAliasLines(DEFAULT_DATE_ALIASES));
			});
			button.buttonEl.addClass("qa-date-alias-reset");
		});
	}

	private renderDevInfo(setting: Setting): void {
		const infoContainer = setting.settingEl.createDiv();
		infoContainer.addClass("qa-dev-info");

		renderDevelopmentInfo(infoContainer, {
			branch: __DEV_GIT_BRANCH__,
			commit: __DEV_GIT_COMMIT__,
			dirty: __DEV_GIT_DIRTY__,
		});
	}
}

function templateFolderPaths(): string[] {
	return normalizeTemplateFolderPaths(settingsStore.getState().templateFolderPaths);
}
