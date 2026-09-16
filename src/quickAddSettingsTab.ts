import type {
	App,
	Setting,
	SettingDefinitionItem,
	TextAreaComponent,
} from "obsidian";
import {
	ButtonComponent,
	ExtraButtonComponent,
	PluginSettingTab,
	TextComponent,
} from "obsidian";
import type QuickAdd from "./main";
import type IChoice from "./types/choices/IChoice";
import ChoiceView from "./gui/choiceList/ChoiceView.svelte";
import ChoicesUnavailable from "./gui/choiceList/ChoicesUnavailable.svelte";
import { mountComponent, type MountHandle } from "./gui/svelte/mountComponent";
import type { Plain } from "./gui/svelte/persist.svelte";
import { GenericTextSuggester } from "./gui/suggesters/genericTextSuggester";
import GlobalVariablesView from "./gui/GlobalVariables/GlobalVariablesView.svelte";
import { settingsStore } from "./settingsStore";
import {
	getAllFolderPathsInVault,
	normalizeTemplateFolderPaths,
} from "./utilityObsidian";
import { sortFolderPathsByTree } from "./utils/folder-sorting";
import { ExportPackageModal } from "./gui/PackageManager/ExportPackageModal";
import { ImportPackageModal } from "./gui/PackageManager/ImportPackageModal";
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

export class QuickAddSettingsTab extends PluginSettingTab {
	public plugin: QuickAdd;
	private choiceViewHandle: MountHandle | null = null;
	private globalVariablesViewHandle: MountHandle | null = null;
	/** Live store subscription behind the Packages row's Export state. */
	private packagesUnsubscribe: (() => void) | null = null;

	constructor(app: App, plugin: QuickAdd) {
		super(app, plugin);
		this.plugin = plugin;
		this.icon = "zap";
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

		// `inputPrompt` is stored as an enum but surfaced as a boolean toggle.
		if (key === "inputPrompt") {
			return state.inputPrompt === "multi-line";
		}

		return state[key as keyof QuickAddSettings];
	}

	override setControlValue(key: string, value: unknown): void {
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
			templateFolders: (setting) => this.renderTemplateFolderPaths(setting),
			globalVariables: (setting) => this.renderGlobalVariablesView(setting),
			developmentInfo: (setting) => this.renderDevInfo(setting),
		}, __IS_DEV_BUILD__);
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
		this.choiceViewHandle?.destroy();
		this.choiceViewHandle = null;
		this.globalVariablesViewHandle?.destroy();
		this.globalVariablesViewHandle = null;
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
		key: "choiceViewHandle" | "globalVariablesViewHandle",
		mount: (target: HTMLElement) => MountHandle,
	): () => void {
		this.prepareFullWidthSetting(setting);
		this[key]?.destroy();
		const handle = mount(setting.controlEl);
		this[key] = handle;
		// A stale row cleanup must never destroy or clear its replacement.
		return () => {
			handle.destroy();
			if (this[key] === handle) this[key] = null;
		};
	}

	private renderChoicesView(setting: Setting): () => void {
		return this.mountView(setting, "choiceViewHandle", (target) =>
			mountComponent(
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
				},
				// The choice list is the one view whose failure has a recovery story worth
				// spelling out (the data.json advice in ChoicesUnavailable), and the same
				// card the view itself shows when the tree is unreadable — so a mount
				// failure and a render failure look identical to the user.
				{ what: "your choices", fallbackComponent: ChoicesUnavailable },
			),
		);
	}

	private renderGlobalVariablesView(setting: Setting): () => void {
		return this.mountView(setting, "globalVariablesViewHandle", (target) =>
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
				new ImportPackageModal(this.app).open();
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

	private renderTemplateFolderPaths(setting: Setting): () => void {
		// Let this row span the full pane (label/desc stacked above a full-width
		// list) instead of cramming a growing list into the narrow control column.
		setting.settingEl.addClass("qa-template-folders-setting");

		const container = setting.controlEl.createDiv("qa-template-folders");
		const listEl = container.createDiv("qa-template-folder-list");

		const getPaths = (): string[] =>
			normalizeTemplateFolderPaths(settingsStore.getState().templateFolderPaths);
		const setPaths = (paths: string[]): void => {
			settingsStore.setState({ templateFolderPaths: paths });
		};

		const renderList = (): void => {
			listEl.empty();
			const paths = getPaths();
			if (paths.length === 0) {
				listEl.createDiv({
					cls: "qa-template-folder-empty",
					text: "No folders added yet.",
				});
				return;
			}
			for (const folder of paths) {
				const row = listEl.createDiv("qa-template-folder-row");
				// title gives desktop a hover tooltip for paths truncated by ellipsis;
				// on mobile (no hover) the path wraps instead — see styles.css.
				row.createSpan({
					cls: "qa-template-folder-name",
					text: folder,
					attr: { title: folder },
				});
				new ExtraButtonComponent(row)
					.setIcon("trash-2")
					.setTooltip(`Remove ${folder}`)
					.onClick(() => {
						setPaths(getPaths().filter((f) => f !== folder));
						renderList();
					});
			}
		};

		const inputRow = container.createDiv("qa-template-folder-input-row");
		const input = new TextComponent(inputRow);
		input.setPlaceholder("templates/");
		input.inputEl.addClass("qa-template-folder-input");
		const suggester = new GenericTextSuggester(
			this.app,
			input.inputEl,
			sortFolderPathsByTree(getAllFolderPathsInVault(this.app)).filter(
				(path) => path !== "/",
			),
		);

		const addFolder = (): void => {
			// Store the canonical (normalized) form so "templates" and "templates/"
			// can't both be added, and dedupe against the existing list.
			const [folder] = normalizeTemplateFolderPaths([input.inputEl.value]);
			input.inputEl.value = "";
			if (!folder) return;
			const paths = getPaths();
			if (paths.includes(folder)) return;
			setPaths([...paths, folder]);
			renderList();
		};

		const onKeydown = (e: KeyboardEvent): void => {
			if (e.key === "Enter") {
				e.preventDefault();
				addFolder();
			}
		};
		input.inputEl.addEventListener("keydown", onKeydown);
		new ButtonComponent(inputRow)
			.setCta()
			.setButtonText("Add")
			.onClick(() => addFolder());

		renderList();

		// The suggester registers global (document/window) listeners while open;
		// tear it down when the row is rebuilt or the tab hides so nothing leaks.
		return () => {
			input.inputEl.removeEventListener("keydown", onKeydown);
			suggester.destroy();
		};
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
