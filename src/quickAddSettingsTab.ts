import type {
	App,
	Setting,
	SettingDefinitionGroup,
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

/** String-named keys of {@link QuickAddSettings} — used to type the declarative
 * `control` keys so a mistyped key is caught at compile time. */
type SettingsKey = Extract<keyof QuickAddSettings, string>;

export class QuickAddSettingsTab extends PluginSettingTab {
	public plugin: QuickAdd;
	private choiceViewHandle: MountHandle | null = null;
	private globalVariablesViewHandle: MountHandle | null = null;

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
		const groups: SettingDefinitionGroup<SettingsKey>[] = [
			this.choicesAndPackagesGroup(),
			this.choicePickerGroup(),
			this.inputGroup(),
			this.templatesGroup(),
			this.notificationsGroup(),
			this.globalVariablesGroup(),
			this.aiAndOnlineGroup(),
			this.appearanceGroup(),
		];

		if (__IS_DEV_BUILD__) {
			groups.push(this.developerGroup());
		}

		return groups;
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
	}

	// ----- group builders -----

	private choicesAndPackagesGroup(): SettingDefinitionGroup<SettingsKey> {
		return {
			type: "group",
			heading: "Choices & Packages",
			items: [
				{
					name: "Choices",
					render: (setting) => this.renderChoicesView(setting),
				},
				{
					name: "Packages",
					desc: "Bundle or import QuickAdd automations as reusable packages.",
					render: (setting) => this.renderPackages(setting),
				},
			],
		};
	}

	private choicePickerGroup(): SettingDefinitionGroup<SettingsKey> {
		return {
			type: "group",
			heading: "Choice Picker",
			items: [
				{
					name: "Search nested choices",
					desc: "When searching in the choice picker, also match choices nested inside Multi choices and show their path. Note that nested matches can outrank same-level ones. Disable to search only the open level.",
					control: { type: "toggle", key: "searchNestedChoices" },
				},
				{
					name: "“New note from template” in the launcher",
					desc: "Add a row to Run QuickAdd that lists templates from your configured template folder, so you can create a note from a template without a dedicated Template choice. Only appears when a template folder is configured; the command palette entry works regardless.",
					control: {
						type: "dropdown",
						key: "templateFolderLauncherRow",
						defaultValue: "bottom",
						options: {
							bottom: "Show at the bottom (keeps your top choice first)",
							top: "Show at the top",
							off: "Hide",
						},
					},
				},
			],
		};
	}

	private inputGroup(): SettingDefinitionGroup<SettingsKey> {
		return {
			type: "group",
			heading: "Input",
			items: [
				{
					name: "Use Multi-line Input Prompt",
					desc: "Use multi-line input prompt instead of single-line input prompt. Submit multi-line prompts with Ctrl/Cmd+Enter; Enter inserts a newline.",
					control: { type: "toggle", key: "inputPrompt" },
				},
				{
					name: "Persist Input Prompt Drafts",
					desc: "Keep drafts when closing input prompts so they can be restored on reopen. Drafts are stored only for this session.",
					control: { type: "toggle", key: "persistInputPromptDrafts" },
				},
				{
					name: "Use editor selection as default Capture value",
					desc: "When enabled, Capture uses the current editor selection as {{VALUE}} and may skip the prompt. When disabled, Capture always prompts for {{VALUE}}.",
					control: { type: "toggle", key: "useSelectionAsCaptureValue" },
				},
				{
					name: "One-page input for choices",
					desc: "Collect a choice's inputs in one form before it runs, instead of one prompt at a time. Works with Template and Capture choices, and with Macros whose scripts declare inputs. Template and Capture choices can override this individually. See One-page Inputs in the docs.",
					control: { type: "toggle", key: "onePageInputEnabled" },
				},
				{
					name: "Date aliases",
					desc:
						"Shortcodes for natural language date parsing. " +
						"One per line: alias = phrase. Example: tm = tomorrow.",
					render: (setting) => this.renderDateAliases(setting),
				},
			],
		};
	}

	private templatesGroup(): SettingDefinitionGroup<SettingsKey> {
		return {
			type: "group",
			heading: "Templates & Properties",
			items: [
				{
					name: "Template folder paths",
					desc: "Folders where templates are stored. Used to suggest template files when configuring QuickAdd. Add as many as you like; leave empty to suggest every template file in the vault.",
					render: (setting) => this.renderTemplateFolderPaths(setting),
				},
				{
					name: "Convert string front matter variables to typed properties (Beta)",
					desc:
						"List/object values from scripts are always written as proper Obsidian properties (a list becomes a List). " +
						"This toggle additionally converts string values into typed properties: a comma or bullet-list string becomes a List, " +
						"\"42\" becomes a Number, \"true\" becomes a Checkbox, etc. Disabled by default; the string conversion is a beta heuristic that may have edge cases.",
					control: { type: "toggle", key: "enableTemplatePropertyTypes" },
				},
			],
		};
	}

	private notificationsGroup(): SettingDefinitionGroup<SettingsKey> {
		return {
			type: "group",
			heading: "Notifications",
			items: [
				{
					name: "Announce Updates",
					desc: "Display release notes when a new version is installed. This includes new features, demo videos, and bug fixes.",
					control: {
						type: "dropdown",
						key: "announceUpdates",
						defaultValue: "major",
						options: {
							all: "Show updates on each new release",
							major:
								"Show updates only on major releases (new features, breaking changes)",
							none: "Don't show",
						},
					},
				},
				{
					name: "Show Capture Notifications",
					desc: "Display a notification when content is captured successfully to confirm the operation completed.",
					control: { type: "toggle", key: "showCaptureNotification" },
				},
				{
					name: "Show Input Cancellation Notifications",
					desc: "Display a notification when an input prompt is cancelled without submitting. Disable this to avoid extra notices when dismissing prompts.",
					control: {
						type: "toggle",
						key: "showInputCancellationNotification",
					},
				},
			],
		};
	}

	private globalVariablesGroup(): SettingDefinitionGroup<SettingsKey> {
		return {
			type: "group",
			heading: "Global Variables",
			items: [
				{
					name: "Global Variables",
					render: (setting) => this.renderGlobalVariablesView(setting),
				},
			],
		};
	}

	private aiAndOnlineGroup(): SettingDefinitionGroup<SettingsKey> {
		return {
			type: "group",
			heading: "AI & Online",
			items: [
				{
					name: "Disable AI & Online features",
					desc: "This prevents the plugin from making requests to external providers like OpenAI. You can still use User Scripts to execute arbitrary code, including contacting external providers. However, this setting disables plugin features like the AI Assistant from doing so. You need to disable this setting to use the AI Assistant.",
					control: { type: "toggle", key: "disableOnlineFeatures" },
				},
				{
					name: "Allow URI x-callback-url",
					desc: "When on, an obsidian://quickadd URI may open a callback URL (x-success / x-error / x-cancel) after a Template or Capture choice finishes — sending the outcome and the affected note's vault path and URL to that callback. While on, a URI that carries x-* callback params is restricted to Template and Capture choices (other choice types are warned and skipped). Off by default because the callback URL is set by whoever creates the obsidian:// link. Only shortcuts: and obsidian: callback URLs are permitted.",
					control: { type: "toggle", key: "enableUriCallbacks" },
				},
			],
		};
	}

	private appearanceGroup(): SettingDefinitionGroup<SettingsKey> {
		return {
			type: "group",
			heading: "Appearance",
			items: [
				{
					name: "Show icon in sidebar",
					desc: "Add QuickAdd icon to the sidebar ribbon. Requires a reload.",
					control: { type: "toggle", key: "enableRibbonIcon" },
				},
			],
		};
	}

	private developerGroup(): SettingDefinitionGroup<SettingsKey> {
		return {
			type: "group",
			heading: "Developer",
			items: [
				{
					name: "Development Information",
					desc: "Git information for developers.",
					render: (setting) => this.renderDevInfo(setting),
				},
			],
		};
	}

	// ----- render helpers -----

	/** Strip the label/description column and let a row span the full width —
	 * used to host the mounted Svelte views. The declarative API requires a
	 * `name` on every definition (for search indexing); we set it on the def and
	 * remove the rendered `infoEl` here so the view still spans full width. */
	private prepareFullWidthSetting(setting: Setting): void {
		setting.infoEl.remove();
		setting.settingEl.addClass("qa-setting-full-width");
		setting.controlEl.addClass("qa-setting-full-width-control");
	}

	private renderChoicesView(setting: Setting): () => void {
		this.prepareFullWidthSetting(setting);

		this.choiceViewHandle?.destroy();
		const handle = mountComponent(setting.controlEl, ChoiceView, {
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
		});
		this.choiceViewHandle = handle;

		// Capture the handle so a stale cleanup can only ever destroy its own
		// mount (and only nulls the field while it still points at this mount).
		return () => {
			handle.destroy();
			if (this.choiceViewHandle === handle) {
				this.choiceViewHandle = null;
			}
		};
	}

	private renderGlobalVariablesView(setting: Setting): () => void {
		this.prepareFullWidthSetting(setting);

		this.globalVariablesViewHandle?.destroy();
		const handle = mountComponent(
			setting.controlEl,
			GlobalVariablesView,
			{ app: this.app, plugin: this.plugin },
		);
		this.globalVariablesViewHandle = handle;

		return () => {
			handle.destroy();
			if (this.globalVariablesViewHandle === handle) {
				this.globalVariablesViewHandle = null;
			}
		};
	}

	private renderPackages(setting: Setting): void {
		// Both package actions are secondary utilities — not the page's primary
		// action ("New choice" is) — so neither is a CTA. Keeping only one filled
		// primary button in the view avoids competing purple CTAs (per the
		// one-primary-button-per-page rule).
		setting.addButton((button) =>
			button
				.setButtonText("Export package…")
				.onClick(() => {
					const choicesSnapshot = settingsStore.getState().choices;
					new ExportPackageModal(
						this.app,
						this.plugin,
						choicesSnapshot,
					).open();
				}),
		);

		setting.addButton((button) =>
			button.setButtonText("Import package…").onClick(() => {
				new ImportPackageModal(this.app).open();
			}),
		);
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
