import type {
	App,
	Setting,
	SettingDefinitionGroup,
	SettingDefinitionItem,
	TAbstractFile,
	TextAreaComponent,
} from "obsidian";
import { PluginSettingTab, TFolder } from "obsidian";
import type QuickAdd from "./main";
import type IChoice from "./types/choices/IChoice";
import ChoiceView from "./gui/choiceList/ChoiceView.svelte";
import { mountComponent, type MountHandle } from "./gui/svelte/mountComponent";
import type { Plain } from "./gui/svelte/persist.svelte";
import { GenericTextSuggester } from "./gui/suggesters/genericTextSuggester";
import GlobalVariablesView from "./gui/GlobalVariables/GlobalVariablesView.svelte";
import { settingsStore } from "./settingsStore";
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
					desc: "Use multi-line input prompt instead of single-line input prompt",
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
					name: "One-page input for choices (Beta)",
					desc: "Experimental. Resolve variables up front and show a single dynamic form before executing Template/Capture choices. See Advanced → One-page Inputs in docs.",
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
					name: "Template Folder Path",
					desc: "Path to the folder where templates are stored. Used to suggest template files when configuring QuickAdd.",
					render: (setting) => this.renderTemplateFolderPath(setting),
				},
				{
					name: "Format template variables as proper property types (Beta)",
					desc:
						"When enabled, template variables in front matter will be formatted as proper Obsidian property types. " +
						"Arrays become List properties, numbers become Number properties, booleans become Checkbox properties, etc. " +
						"This is a beta feature that may have edge cases.",
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

	private renderTemplateFolderPath(setting: Setting): void {
		setting.addText((text) => {
			text
				.setPlaceholder("templates/")
				.setValue(settingsStore.getState().templateFolderPath)
				.onChange((value) => {
					settingsStore.setState({ templateFolderPath: value });
				});

			new GenericTextSuggester(
				this.app,
				text.inputEl,
				this.app.vault
					.getAllLoadedFiles()
					.filter(
						(f: TAbstractFile) => f instanceof TFolder && f.path !== "/",
					)
					.map((f: TAbstractFile) => f.path),
			);
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
