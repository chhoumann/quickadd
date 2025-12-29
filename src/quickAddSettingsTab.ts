import type { App, TAbstractFile } from "obsidian";
import type { TextAreaComponent } from "obsidian";
import {
	BaseComponent,
	PluginSettingTab,
	Setting,
	SettingGroup,
	TFolder,
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
import { t } from "./i18n/i18n";

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

		const choicesGroup = this.createSettingGroup(t("settings.headers.choices"));
		this.addChoicesSetting(choicesGroup);
		this.addPackagesSetting(choicesGroup);

		const inputGroup = this.createSettingGroup(t("settings.headers.input"));
		this.addUseMultiLineInputPromptSetting(inputGroup);
		this.addPersistInputPromptDraftsSetting(inputGroup);
		this.addUseSelectionAsValueSetting(inputGroup);
		this.addOnePageInputSetting(inputGroup);
		this.addDateAliasesSetting(inputGroup);

		const templatesGroup = this.createSettingGroup(t("settings.headers.templates"));
		this.addTemplateFolderPathSetting(templatesGroup);
		this.addTemplatePropertyTypesSetting(templatesGroup);

		const notificationsGroup = this.createSettingGroup(t("settings.headers.notifications"));
		this.addAnnounceUpdatesSetting(notificationsGroup);
		this.addShowCaptureNotificationSetting(notificationsGroup);
		this.addShowInputCancellationNotificationSetting(notificationsGroup);

		const globalsGroup = this.createSettingGroup(t("settings.headers.globals"));
		this.addGlobalVariablesSetting(globalsGroup);

		const onlineGroup = this.createSettingGroup(t("settings.headers.ai_online"));
		this.addDisableOnlineFeaturesSetting(onlineGroup);

		const appearanceGroup = this.createSettingGroup(t("settings.headers.appearance"));
		this.addEnableRibbonIconSetting(appearanceGroup);

		if (__IS_DEV_BUILD__) {
			const devGroup = this.createSettingGroup(t("settings.headers.dev"));
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
			setting.setName(t("settings.dev.info_name"));
			setting.setDesc(t("settings.dev.info_desc"));

			const infoContainer = setting.settingEl.createDiv();
			infoContainer.style.marginTop = "10px";
			infoContainer.style.fontFamily = "var(--font-monospace)";
			infoContainer.style.fontSize = "0.9em";

			if (__DEV_GIT_BRANCH__ !== null) {
				const branchDiv = infoContainer.createDiv();
				branchDiv.innerHTML = `<strong>${t("settings.dev.branch")}:</strong> ${__DEV_GIT_BRANCH__}`;
				branchDiv.style.marginBottom = "5px";
			}

			if (__DEV_GIT_COMMIT__ !== null) {
				const commitDiv = infoContainer.createDiv();
				commitDiv.innerHTML = `<strong>${t("settings.dev.commit")}:</strong> ${__DEV_GIT_COMMIT__}`;
				commitDiv.style.marginBottom = "5px";
			}

			if (__DEV_GIT_DIRTY__ !== null) {
				const statusDiv = infoContainer.createDiv();
				const statusText = __DEV_GIT_DIRTY__
					? `${t("settings.dev.yes")} (${t("settings.dev.changes")})`
					: t("settings.dev.no");
				const statusColor = __DEV_GIT_DIRTY__
					? "var(--text-warning)"
					: "var(--text-success)";
				statusDiv.innerHTML = `<strong>${t("settings.dev.changes")}:</strong> <span style="color: ${statusColor}">${statusText}</span>`;
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
			setting.setName(t("settings.packages.name"));
			setting.setDesc(t("settings.packages.desc"));

			setting.addButton((button) =>
				button
					.setButtonText(t("settings.packages.export"))
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
				button.setButtonText(t("settings.packages.import")).onClick(() => {
					const modal = new ImportPackageModal(this.app);
					modal.open();
				}),
			);
		});
	}

	private addAnnounceUpdatesSetting(group: SettingGroupLike) {
		group.addSetting((setting) => {
			setting.setName(t("settings.announce.name"));
			setting.setDesc(t("settings.announce.desc"));
			setting.addDropdown((dropdown) => {
				const currentValue = settingsStore.getState().announceUpdates;
				dropdown
					.addOption("all", t("settings.announce.all"))
					.addOption("major", t("settings.announce.major"))
					.addOption("none", t("settings.announce.none"))
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
			setting.setName(t("settings.capture_notif.name"));
			setting.setDesc(t("settings.capture_notif.desc"));
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
			setting.setName(t("settings.cancel_notif.name"));
			setting.setDesc(t("settings.cancel_notif.desc"));
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
			setting.setName(t("settings.template_properties.name"));
			setting.setDesc(t("settings.template_properties.desc"));
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
				.setName(t("settings.multiline.name"))
				.setDesc(t("settings.multiline.desc"))
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.inputPrompt === "multi-line")
						.setTooltip(t("settings.multiline.name"))
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
				.setName(t("settings.persist.name"))
				.setDesc(t("settings.persist.desc"))
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

	private addUseSelectionAsValueSetting(group: SettingGroupLike) {
		group.addSetting((setting) => {
			setting
				.setName(t("settings.selection_capture.name"))
				.setDesc(t("settings.selection_capture.desc"))
				.addToggle((toggle) =>
					toggle
						.setValue(settingsStore.getState().useSelectionAsCaptureValue)
						.onChange((value) => {
							settingsStore.setState({ useSelectionAsCaptureValue: value });
						}),
				);
		});
	}

	private addTemplateFolderPathSetting(group: SettingGroupLike) {
		group.addSetting((setting) => {
			setting.setName(t("settings.template_folder.name"));
			setting.setDesc(t("settings.template_folder.desc"));

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
				.setName(t("settings.one_page.name"))
				.setDesc(t("settings.one_page.desc"))
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
			setting.setName(t("settings.date_aliases.name"));
			setting.setDesc(t("settings.date_aliases.desc"));
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
					.setButtonText(t("settings.date_aliases.reset"))
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
				.setName(t("settings.disable_online.name"))
				.setDesc(t("settings.disable_online.desc"))
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
				.setName(t("settings.ribbon_options.name"))
				.setDesc(t("settings.ribbon_options.desc"))
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
