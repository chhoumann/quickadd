import type { App, TAbstractFile } from "obsidian";
import {
	BaseComponent,
	PluginSettingTab,
	Setting,
	SettingGroup,
	TFolder,
	TextAreaComponent,
} from "obsidian";
import type QuickAdd from "./main";
import type IChoice from "./types/choices/IChoice";
import ChoiceView from "./gui/choiceList/ChoiceView.svelte";
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

type SettingGroupLike = {
	addSetting(cb: (setting: Setting) => void): void;
};

class SvelteSettingComponent extends BaseComponent {
	constructor(public containerEl: HTMLElement) {
		super();
	}
}

export class QuickAddSettingsTab extends PluginSettingTab {
	public plugin: QuickAdd;
	private choiceView: ChoiceView | null = null;
	private globalVariablesView: GlobalVariablesView | null = null;

	constructor(app: App, plugin: QuickAdd) {
		super(app, plugin);
		this.plugin = plugin;
		this.icon = "zap";
	}

	display(): void {
		this.destroySettingViews();

		const { containerEl } = this;
		containerEl.empty();

		const choicesGroup = this.createSettingGroup("Choices & Packages");
		this.addChoicesSetting(choicesGroup);
		this.addPackagesSetting(choicesGroup);

		const inputGroup = this.createSettingGroup("Input");
		this.addUseMultiLineInputPromptSetting(inputGroup);
		this.addPersistInputPromptDraftsSetting(inputGroup);
		this.addOnePageInputSetting(inputGroup);
		this.addDateAliasesSetting(inputGroup);

		const templatesGroup = this.createSettingGroup("Templates & Properties");
		this.addTemplateFolderPathSetting(templatesGroup);
		this.addTemplatePropertyTypesSetting(templatesGroup);

		const notificationsGroup = this.createSettingGroup("Notifications");
		this.addAnnounceUpdatesSetting(notificationsGroup);
		this.addShowCaptureNotificationSetting(notificationsGroup);
		this.addShowInputCancellationNotificationSetting(notificationsGroup);

		const globalsGroup = this.createSettingGroup("Global Variables");
		this.addGlobalVariablesSetting(globalsGroup);

		const onlineGroup = this.createSettingGroup("AI & Online");
		this.addDisableOnlineFeaturesSetting(onlineGroup);

		const appearanceGroup = this.createSettingGroup("Appearance");
		this.addEnableRibbonIconSetting(appearanceGroup);

		if (__IS_DEV_BUILD__) {
			const devGroup = this.createSettingGroup("Developer");
			this.addDevelopmentInfoSetting(devGroup);
		}
	}

	private destroySettingViews(): void {
		this.choiceView?.$destroy();
		this.choiceView = null;
		this.globalVariablesView?.$destroy();
		this.globalVariablesView = null;
	}

	private createSettingGroup(
		heading: string,
		className?: string,
	): SettingGroupLike {
		if (typeof SettingGroup === "function") {
			const group = new SettingGroup(this.containerEl).setHeading(heading);
			if (className) group.addClass(className);
			return group;
		}

		const headingSetting = new Setting(this.containerEl)
			.setName(heading)
			.setHeading();
		if (className) headingSetting.settingEl.addClass(className);

		return {
			addSetting: (cb) => {
				cb(new Setting(this.containerEl));
			},
		};
	}

	private prepareFullWidthSetting(setting: Setting): void {
		setting.infoEl.remove();
		setting.settingEl.style.display = "block";
		setting.controlEl.style.width = "100%";
		setting.controlEl.style.flex = "1 1 auto";
		setting.controlEl.style.display = "block";
		setting.controlEl.style.marginLeft = "0";
		setting.controlEl.style.justifyContent = "flex-start";
		setting.controlEl.style.alignItems = "stretch";
		setting.controlEl.style.textAlign = "left";
	}

	private addDevelopmentInfoSetting(group: SettingGroupLike) {
		group.addSetting((setting) => {
			setting.setName("Development Information");
			setting.setDesc("Git information for developers.");

			const infoContainer = setting.settingEl.createDiv();
			infoContainer.style.marginTop = "10px";
			infoContainer.style.fontFamily = "var(--font-monospace)";
			infoContainer.style.fontSize = "0.9em";

			if (__DEV_GIT_BRANCH__ !== null) {
				const branchDiv = infoContainer.createDiv();
				branchDiv.innerHTML = `<strong>Branch:</strong> ${__DEV_GIT_BRANCH__}`;
				branchDiv.style.marginBottom = "5px";
			}

			if (__DEV_GIT_COMMIT__ !== null) {
				const commitDiv = infoContainer.createDiv();
				commitDiv.innerHTML = `<strong>Commit:</strong> ${__DEV_GIT_COMMIT__}`;
				commitDiv.style.marginBottom = "5px";
			}

			if (__DEV_GIT_DIRTY__ !== null) {
				const statusDiv = infoContainer.createDiv();
				const statusText = __DEV_GIT_DIRTY__
					? "Yes (uncommitted changes)"
					: "No";
				const statusColor = __DEV_GIT_DIRTY__
					? "var(--text-warning)"
					: "var(--text-success)";
				statusDiv.innerHTML = `<strong>Uncommitted changes:</strong> <span style="color: ${statusColor}">${statusText}</span>`;
			}
		});
	}

	private addGlobalVariablesSetting(group: SettingGroupLike) {
		group.addSetting((setting) => {
			this.prepareFullWidthSetting(setting);

			const mountView = (target: HTMLElement) => {
				this.globalVariablesView = new GlobalVariablesView({
					target,
					props: { app: this.app, plugin: this.plugin },
				});
			};

			if (typeof setting.addComponent === "function") {
				setting.addComponent((el) => {
					mountView(el);
					return new SvelteSettingComponent(el);
				});
				return;
			}

			mountView(setting.settingEl);
		});
	}

	private addChoicesSetting(group: SettingGroupLike): void {
		group.addSetting((setting) => {
			this.prepareFullWidthSetting(setting);

			const mountView = (target: HTMLElement) => {
				this.choiceView = new ChoiceView({
					target,
					props: {
						app: this.app,
						plugin: this.plugin,
						choices: settingsStore.getState().choices,
						saveChoices: (choices: IChoice[]) => {
							settingsStore.setState({ choices });
						},
					},
				});
			};

			if (typeof setting.addComponent === "function") {
				setting.addComponent((el) => {
					mountView(el);
					return new SvelteSettingComponent(el);
				});
				return;
			}

			mountView(setting.settingEl);
		});
	}

	private addPackagesSetting(group: SettingGroupLike): void {
		group.addSetting((setting) => {
			setting.setName("Packages");
			setting.setDesc(
				"Bundle or import QuickAdd automations as reusable packages.",
			);

			setting.addButton((button) =>
				button
					.setButtonText("Export package…")
					.setCta()
					.onClick(() => {
						const choicesSnapshot = settingsStore.getState().choices;
						const modal = new ExportPackageModal(
							this.app,
							this.plugin,
							choicesSnapshot,
						);
						modal.open();
					}),
			);

			setting.addButton((button) =>
				button.setButtonText("Import package…").onClick(() => {
					const modal = new ImportPackageModal(this.app);
					modal.open();
				}),
			);
		});
	}

	private addAnnounceUpdatesSetting(group: SettingGroupLike) {
		group.addSetting((setting) => {
			setting.setName("Announce Updates");
			setting.setDesc(
				"Display release notes when a new version is installed. This includes new features, demo videos, and bug fixes.",
			);
			setting.addDropdown((dropdown) => {
				const currentValue = settingsStore.getState().announceUpdates;
				dropdown
					.addOption("all", "Show updates on each new release")
					.addOption(
						"major",
						"Show updates only on major releases (new features, breaking changes)",
					)
					.addOption("none", "Don't show")
					.setValue(currentValue)
					.onChange((value) => {
						settingsStore.setState({
							announceUpdates: value as QuickAddSettings["announceUpdates"],
						});
					});
			});
		});
	}

	private addShowCaptureNotificationSetting(group: SettingGroupLike) {
		group.addSetting((setting) => {
			setting.setName("Show Capture Notifications");
			setting.setDesc(
				"Display a notification when content is captured successfully to confirm the operation completed.",
			);
			setting.addToggle((toggle) => {
				toggle.setValue(settingsStore.getState().showCaptureNotification);
				toggle.onChange((value) => {
					settingsStore.setState({ showCaptureNotification: value });
				});
			});
		});
	}

	private addShowInputCancellationNotificationSetting(group: SettingGroupLike) {
		group.addSetting((setting) => {
			setting.setName("Show Input Cancellation Notifications");
			setting.setDesc(
				"Display a notification when an input prompt is cancelled without submitting. Disable this to avoid extra notices when dismissing prompts.",
			);
			setting.addToggle((toggle) => {
				toggle.setValue(
					settingsStore.getState().showInputCancellationNotification,
				);
				toggle.onChange((value) => {
					settingsStore.setState({
						showInputCancellationNotification: value,
					});
				});
			});
		});
	}

	private addTemplatePropertyTypesSetting(group: SettingGroupLike) {
		group.addSetting((setting) => {
			setting.setName(
				"Format template variables as proper property types (Beta)",
			);
			setting.setDesc(
				"When enabled, template variables in front matter will be formatted as proper Obsidian property types. " +
					"Arrays become List properties, numbers become Number properties, booleans become Checkbox properties, etc. " +
					"This is a beta feature that may have edge cases.",
			);
			setting.addToggle((toggle) => {
				toggle.setValue(settingsStore.getState().enableTemplatePropertyTypes);
				toggle.onChange((value) => {
					settingsStore.setState({ enableTemplatePropertyTypes: value });
				});
			});
		});
	}

	hide(): void {
		this.destroySettingViews();
	}

	private addUseMultiLineInputPromptSetting(group: SettingGroupLike) {
		group.addSetting((setting) => {
			setting
				.setName("Use Multi-line Input Prompt")
				.setDesc(
					"Use multi-line input prompt instead of single-line input prompt",
				)
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.inputPrompt === "multi-line")
						.setTooltip("Use multi-line input prompt")
						.onChange((value) => {
							if (value) {
								settingsStore.setState({
									inputPrompt: "multi-line",
								});
							} else {
								settingsStore.setState({
									inputPrompt: "single-line",
								});
							}
						}),
				);
		});
	}

	private addPersistInputPromptDraftsSetting(group: SettingGroupLike) {
		group.addSetting((setting) => {
			setting
				.setName("Persist Input Prompt Drafts")
				.setDesc(
					"Keep drafts when closing input prompts so they can be restored on reopen. Drafts are stored only for this session.",
				)
				.addToggle((toggle) =>
					toggle
						.setValue(settingsStore.getState().persistInputPromptDrafts)
						.onChange((value) => {
							settingsStore.setState({ persistInputPromptDrafts: value });
							if (!value) {
								InputPromptDraftStore.getInstance().clearAll();
							}
						}),
				);
		});
	}

	private addTemplateFolderPathSetting(group: SettingGroupLike) {
		group.addSetting((setting) => {
			setting.setName("Template Folder Path");
			setting.setDesc(
				"Path to the folder where templates are stored. Used to suggest template files when configuring QuickAdd.",
			);

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
							(f: TAbstractFile) =>
								f instanceof TFolder && f.path !== "/",
						)
						.map((f: TAbstractFile) => f.path),
				);
			});
		});
	}

	private addOnePageInputSetting(group: SettingGroupLike) {
		group.addSetting((setting) => {
			setting
				.setName("One-page input for choices (Beta)")
				.setDesc(
					"Experimental. Resolve variables up front and show a single dynamic form before executing Template/Capture choices. See Advanced → One-page Inputs in docs.",
				)
				.addToggle((toggle) =>
					toggle
						.setValue(settingsStore.getState().onePageInputEnabled)
						.onChange((value) => {
							settingsStore.setState({ onePageInputEnabled: value });
						}),
				);
		});
	}

	private addDateAliasesSetting(group: SettingGroupLike) {
		group.addSetting((setting) => {
			setting.setName("Date aliases");
			setting.setDesc(
				"Shortcodes for natural language date parsing. " +
					"One per line: alias = phrase. Example: tm = tomorrow.",
			);
			setting.settingEl.style.alignItems = "flex-start";
			setting.controlEl.style.display = "flex";
			setting.controlEl.style.flexWrap = "wrap";
			setting.controlEl.style.gap = "0.5rem";
			setting.controlEl.style.alignItems = "flex-start";
			setting.controlEl.style.flex = "1 1 320px";
			setting.controlEl.style.minWidth = "240px";

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
				textArea.inputEl.style.width = "100%";
				textArea.inputEl.style.minHeight = "6rem";
				textArea.inputEl.style.flex = "1 1 280px";
				textArea.inputEl.style.maxWidth = "100%";
				textArea.inputEl.style.boxSizing = "border-box";
			});

			setting.addButton((button) => {
				button
					.setButtonText("Reset to defaults")
					.onClick(() => {
						settingsStore.setState({
							dateAliases: DEFAULT_DATE_ALIASES,
						});
						if (textAreaRef) {
							textAreaRef.setValue(
								formatDateAliasLines(DEFAULT_DATE_ALIASES),
							);
						}
					});
				button.buttonEl.style.alignSelf = "flex-start";
				button.buttonEl.style.whiteSpace = "nowrap";
			});
		});
	}

	private addDisableOnlineFeaturesSetting(group: SettingGroupLike) {
		group.addSetting((setting) => {
			setting
				.setName("Disable AI & Online features")
				.setDesc(
					"This prevents the plugin from making requests to external providers like OpenAI. You can still use User Scripts to execute arbitrary code, including contacting external providers. However, this setting disables plugin features like the AI Assistant from doing so. You need to disable this setting to use the AI Assistant.",
				)
				.addToggle((toggle) =>
					toggle
						.setValue(settingsStore.getState().disableOnlineFeatures)
						.onChange((value) => {
							settingsStore.setState({
								disableOnlineFeatures: value,
							});

							this.display();
						}),
				);
		});
	}

	private addEnableRibbonIconSetting(group: SettingGroupLike) {
		group.addSetting((setting) => {
			setting
				.setName("Show icon in sidebar")
				.setDesc(
					"Add QuickAdd icon to the sidebar ribbon. Requires a reload.",
				)
				.addToggle((toggle) => {
					toggle
						.setValue(settingsStore.getState().enableRibbonIcon)
						.onChange((value: boolean) => {
							settingsStore.setState({
								enableRibbonIcon: value,
							});

							this.display();
						});
				});
		});
	}
}
