import type { App } from "obsidian";
import {
	ButtonComponent,
	Setting,
	TextComponent,
	ToggleComponent,
} from "obsidian";
import type { fileExistsChoices } from "src/constants";
import {
	fileExistsAppendToBottom,
	fileExistsAppendToTop,
	fileExistsDoNothing,
	fileExistsIncrement,
	fileExistsOverwriteFile,
} from "src/constants";
import { FileNameDisplayFormatter } from "../../formatters/fileNameDisplayFormatter";
import { log } from "../../logger/logManager";
import type QuickAdd from "../../main";
import type ITemplateChoice from "../../types/choices/ITemplateChoice";
import type { LinkPlacement, LinkType } from "../../types/linkPlacement";
import {
	normalizeAppendLinkOptions,
	placementSupportsEmbed,
} from "../../types/linkPlacement";
import { getAllFolderPathsInVault } from "../../utilityObsidian";
import { createValidatedInput } from "../components/validatedInput";
import { ExclusiveSuggester } from "../suggesters/exclusiveSuggester";
import { FormatSyntaxSuggester } from "../suggesters/formatSyntaxSuggester";
import { ChoiceBuilder } from "./choiceBuilder";
import FolderList from "./FolderList.svelte";
import {
	renderFileOpeningSettings,
	renderOnePageOverrideSetting,
	renderOpenFileToggleSetting,
} from "./sharedBehaviorSettings";

export class TemplateChoiceBuilder extends ChoiceBuilder {
	choice: ITemplateChoice;
	private templateSectionEl: HTMLDivElement | null = null;
	private locationSectionEl: HTMLDivElement | null = null;
	private linkingSectionEl: HTMLDivElement | null = null;
	private behaviorSectionEl: HTMLDivElement | null = null;
	private folderListEl: FolderList | null = null;
	private allFolderPathsCache: string[] | null = null;

	constructor(
		app: App,
		choice: ITemplateChoice,
		private plugin: QuickAdd,
	) {
		super(app);
		this.choice = choice;

		this.display();
	}

	protected display() {
		this.containerEl.addClass("templateChoiceBuilder");
		this.contentEl.empty();
		this.destroyFolderList();
		this.addCenteredChoiceNameHeader(this.choice);

		this.templateSectionEl = this.contentEl.createDiv({
			cls: "qa-choice-section",
		});
		this.locationSectionEl = this.contentEl.createDiv({
			cls: "qa-choice-section",
		});
		this.linkingSectionEl = this.contentEl.createDiv({
			cls: "qa-choice-section",
		});
		this.behaviorSectionEl = this.contentEl.createDiv({
			cls: "qa-choice-section",
		});

		this.renderTemplateSection();
		this.renderLocationSection();
		this.renderLinkingSection();
		this.renderBehaviorSection();
	}

	onClose() {
		this.destroyFolderList();
		super.onClose();
	}

	private destroyFolderList(): void {
		this.folderListEl?.$destroy();
		this.folderListEl = null;
	}

	private getAllFolderPaths(): string[] {
		if (!this.allFolderPathsCache) {
			this.allFolderPathsCache = getAllFolderPathsInVault(this.app);
		}
		return this.allFolderPathsCache;
	}

	private renderTemplateSection(): void {
		this.renderSection(this.templateSectionEl, () => {
			new Setting(this.renderParentEl).setName("Template").setHeading();
			this.addTemplatePathSetting();
			this.addFileNameFormatSetting();
		});
	}

	private renderLocationSection(): void {
		this.destroyFolderList();
		this.renderSection(this.locationSectionEl, () => {
			new Setting(this.renderParentEl).setName("Location").setHeading();
			this.addFolderSetting();
		});
	}

	private renderLinkingSection(): void {
		this.renderSection(this.linkingSectionEl, () => {
			new Setting(this.renderParentEl).setName("Linking").setHeading();
			this.addAppendLinkSetting();
		});
	}

	private renderBehaviorSection(): void {
		this.renderSection(this.behaviorSectionEl, () => {
			new Setting(this.renderParentEl).setName("Behavior").setHeading();
			this.addFileAlreadyExistsSetting();
			this.addOpenFileBehaviorSetting();
			if (this.choice.openFile) {
				this.addFileOpeningBehaviorSetting();
			}
			renderOnePageOverrideSetting({
				parent: this.renderParentEl,
				value: this.choice.onePageInput as string | undefined,
				onChange: (value) => {
					this.choice.onePageInput = value as any;
				},
			});
		});
	}

	private addTemplatePathSetting(): void {
		new Setting(this.renderParentEl)
			.setName("Template Path")
			.setDesc("Path to the Template.");

		const templates: string[] = this.plugin
			.getTemplateFiles()
			.map((f) => f.path);

		createValidatedInput({
			app: this.app,
			parent: this.renderParentEl,
			initialValue: this.choice.templatePath,
			placeholder: "Template path",
			suggestions: templates,
			maxSuggestions: 50,
			validator: (raw) => {
				const v = raw.trim();
				if (!v) return true;
				return templates.includes(v) || "Template not found";
			},
			onChange: (value) => {
				this.choice.templatePath = value;
			},
		});
	}

	private addFileNameFormatSetting(): void {
		let textField: TextComponent;
		const enableSetting = new Setting(this.renderParentEl);
		enableSetting
			.setName("File name format")
			.setDesc("Set the file name format.")
			.addToggle((toggleComponent) => {
				toggleComponent
					.setValue(this.choice.fileNameFormat.enabled)
					.onChange((value) => {
						this.choice.fileNameFormat.enabled = value;
						textField.setDisabled(!value);
					});
			});

		const previewRow = this.renderParentEl.createDiv({ cls: "qa-preview-row" });
		previewRow.createEl("span", { text: "Preview: ", cls: "qa-preview-label" });
		const formatDisplay = previewRow.createEl("span");
		formatDisplay.setAttr("aria-live", "polite");
		const displayFormatter: FileNameDisplayFormatter =
			new FileNameDisplayFormatter(this.app, this.plugin);
		formatDisplay.textContent = "Loading preview…";
		void (async () => {
			try {
				formatDisplay.textContent = await displayFormatter.format(
					this.choice.fileNameFormat.format,
				);
			} catch {
				formatDisplay.textContent = "Preview unavailable";
			}
		})();

		const formatInput = new TextComponent(this.renderParentEl);
		formatInput.setPlaceholder("File name format");
		textField = formatInput;
		formatInput.inputEl.style.width = "100%";
		formatInput.inputEl.style.marginBottom = "8px";

		formatInput
			.setValue(this.choice.fileNameFormat.format)
			.setDisabled(!this.choice.fileNameFormat.enabled)
			.onChange(async (value) => {
				this.choice.fileNameFormat.format = value;
				try {
					formatDisplay.textContent = await displayFormatter.format(value);
				} catch {
					formatDisplay.textContent = "Preview unavailable";
				}
			});

		new FormatSyntaxSuggester(this.app, textField.inputEl, this.plugin, true);
	}

	private addFolderSetting(): void {
		const folderSetting: Setting = new Setting(this.renderParentEl);
		folderSetting
			.setName("Create in folder")
			.setDesc(
				"Create the file in the specified folder. If multiple folders are specified, you will be prompted for which folder to create the file in.",
			)
			.addToggle((toggle) => {
				toggle.setValue(this.choice.folder.enabled);
				toggle.onChange((value) => {
					this.choice.folder.enabled = value;
					this.renderLocationSection();
				});
			});

		if (!this.choice.folder.enabled) {
			return;
		}

		if (!this.choice.folder?.createInSameFolderAsActiveFile) {
			const chooseFolderWhenCreatingNoteContainer = this.renderParentEl.createDiv(
				"chooseFolderWhenCreatingNoteContainer",
			);
			chooseFolderWhenCreatingNoteContainer.createEl("span", {
				text: "Choose folder when creating a new note",
			});
			const chooseFolderWhenCreatingNote: ToggleComponent = new ToggleComponent(
				chooseFolderWhenCreatingNoteContainer,
			);
			chooseFolderWhenCreatingNote
				.setValue(this.choice.folder?.chooseWhenCreatingNote)
				.onChange((value) => {
					this.choice.folder.chooseWhenCreatingNote = value;
					this.renderLocationSection();
				});

			if (!this.choice.folder?.chooseWhenCreatingNote) {
				this.addFolderSelector();
			}

			const chooseFolderFromSubfolderContainer: HTMLDivElement =
				this.renderParentEl.createDiv("chooseFolderFromSubfolderContainer");

			const stn = new Setting(chooseFolderFromSubfolderContainer);
			stn
				.setName("Include subfolders")
				.setDesc(
					"Get prompted to choose from both the selected folders and their subfolders when creating the note.",
				)
				.addToggle((toggle) =>
					toggle
						.setValue(this.choice.folder?.chooseFromSubfolders)
						.onChange((value) => {
							this.choice.folder.chooseFromSubfolders = value;
						}),
				);
		}

		if (!this.choice.folder?.chooseWhenCreatingNote) {
			const createInSameFolderAsActiveFileSetting: Setting = new Setting(
				this.renderParentEl,
			);
			createInSameFolderAsActiveFileSetting
				.setName("Create in same folder as active file")
				.setDesc(
					"Creates the file in the same folder as the currently active file. Will not create the file if there is no active file.",
				)
				.addToggle((toggle) =>
					toggle
						.setValue(this.choice.folder?.createInSameFolderAsActiveFile)
						.onChange((value) => {
							this.choice.folder.createInSameFolderAsActiveFile = value;
							this.renderLocationSection();
						}),
				);
		}
	}

	private addFolderSelector() {
		const folderSelectionContainer: HTMLDivElement = this.renderParentEl.createDiv(
			"folderSelectionContainer",
		);
		const folderList: HTMLDivElement =
			folderSelectionContainer.createDiv("folderList");

		const folderListEl = new FolderList({
			target: folderList,
			props: {
				folders: this.choice.folder.folders,
				deleteFolder: (folder: string) => {
					this.choice.folder.folders = this.choice.folder.folders.filter(
						(f) => f !== folder,
					);

					folderListEl.updateFolders(this.choice.folder.folders);
					suggester.updateCurrentItems(this.choice.folder.folders);
				},
			},
		});
		this.folderListEl = folderListEl;

		const inputContainer = folderSelectionContainer.createDiv(
			"folderInputContainer",
		);
		const folderInput = new TextComponent(inputContainer);
		folderInput.inputEl.style.width = "100%";
		folderInput.setPlaceholder("Folder path");
		const allFolders = this.getAllFolderPaths();

		const suggester = new ExclusiveSuggester(
			this.app,
			folderInput.inputEl,
			allFolders,
			this.choice.folder.folders,
		);

		const addFolder = () => {
			const input = folderInput.inputEl.value.trim();

			if (this.choice.folder.folders.some((folder) => folder === input)) {
				log.logWarning("cannot add same folder twice.");
				return;
			}

			this.choice.folder.folders.push(input);

			folderListEl.updateFolders(this.choice.folder.folders);
			folderInput.inputEl.value = "";

			suggester.updateCurrentItems(this.choice.folder.folders);
		};

		folderInput.inputEl.addEventListener("keypress", (e: KeyboardEvent) => {
			if (e.key === "Enter") {
				addFolder();
			}
		});

		const addButton: ButtonComponent = new ButtonComponent(inputContainer);
		addButton
			.setCta()
			.setButtonText("Add")
			.onClick((evt) => {
				addFolder();
			});
	}

	private addAppendLinkSetting(): void {
		const normalizedOptions = normalizeAppendLinkOptions(
			this.choice.appendLink,
		);
		const normalizedLinkType = normalizedOptions.linkType ?? "link";

		type AppendLinkMode = "required" | "optional" | "disabled";
		const currentMode: AppendLinkMode = normalizedOptions.enabled
			? normalizedOptions.requireActiveFile
				? "required"
				: "optional"
			: "disabled";

		const appendLinkSetting: Setting = new Setting(this.renderParentEl);
		appendLinkSetting
			.setName("Link to created file")
			.setDesc(
				"Choose how QuickAdd should insert a link to the created file in the current note.",
			)
			.addDropdown((dropdown) => {
				dropdown.addOption("required", "Enabled (requires active file)");
				dropdown.addOption("optional", "Enabled (skip if no active file)");
				dropdown.addOption("disabled", "Disabled");

				dropdown.setValue(currentMode);
				dropdown.onChange((value: AppendLinkMode) => {
					switch (value) {
						case "disabled":
							this.choice.appendLink = false;
							break;
						case "required":
							this.choice.appendLink = {
								enabled: true,
								placement: normalizedOptions.placement,
								requireActiveFile: true,
								linkType: normalizedLinkType,
							};
							break;
						case "optional":
							this.choice.appendLink = {
								enabled: true,
								placement: normalizedOptions.placement,
								requireActiveFile: false,
								linkType: normalizedLinkType,
							};
							break;
					}
					this.renderLinkingSection();
				});
			});

		if (currentMode !== "disabled") {
			const placementSetting: Setting = new Setting(this.renderParentEl);
			placementSetting
				.setName("Link placement")
				.setDesc("Where to place the link when appending")
				.addDropdown((dropdown) => {
					dropdown.addOption("replaceSelection", "Replace selection");
					dropdown.addOption("afterSelection", "After selection");
					dropdown.addOption("endOfLine", "End of line");
					dropdown.addOption("newLine", "New line");

					dropdown.setValue(normalizedOptions.placement);
					dropdown.onChange((value: LinkPlacement) => {
						const currentValue = this.choice.appendLink;
						const requireActiveFile =
							typeof currentValue === "boolean"
								? normalizedOptions.requireActiveFile
								: currentValue.requireActiveFile;
						const previousLinkType =
							typeof currentValue === "boolean"
								? normalizedLinkType
								: currentValue.linkType ?? normalizedLinkType;
						const nextLinkType = placementSupportsEmbed(value)
							? previousLinkType
							: "link";

						this.choice.appendLink = {
							enabled: true,
							placement: value,
							requireActiveFile,
							linkType: nextLinkType,
						};
						this.renderLinkingSection();
					});
				});

			if (placementSupportsEmbed(normalizedOptions.placement)) {
				const linkTypeSetting: Setting = new Setting(this.renderParentEl);
				linkTypeSetting
					.setName("Link type")
					.setDesc(
						"Choose whether replacing the selection should insert a link or an embed.",
					)
					.addDropdown((dropdown) => {
						dropdown.addOption("link", "Link");
						dropdown.addOption("embed", "Embed");
						dropdown.setValue(normalizedLinkType);
						dropdown.onChange((value: LinkType) => {
							const currentValue = this.choice.appendLink;
							const requireActiveFile =
								typeof currentValue === "boolean"
									? normalizedOptions.requireActiveFile
									: currentValue.requireActiveFile;
							const placement =
								typeof currentValue === "boolean"
									? normalizedOptions.placement
									: currentValue.placement;

							this.choice.appendLink = {
								enabled: true,
								placement,
								requireActiveFile,
								linkType: value,
							};
						});
					});
			}
		}
	}

	private addOpenFileBehaviorSetting(): void {
		renderOpenFileToggleSetting({
			parent: this.renderParentEl,
			value: this.choice.openFile,
			description: "Open the created file.",
			onChange: (value) => {
				this.choice.openFile = value;
				this.renderBehaviorSection();
			},
		});
	}

	private addFileOpeningBehaviorSetting(): void {
		this.choice.fileOpening = renderFileOpeningSettings({
			parent: this.renderParentEl,
			contextLabel: "created",
			fileOpening: this.choice.fileOpening,
			onLocationChange: () => this.renderBehaviorSection(),
		});
	}

	private addFileAlreadyExistsSetting(): void {
		const fileAlreadyExistsSetting: Setting = new Setting(this.renderParentEl);
		fileAlreadyExistsSetting
			.setName("Set default behavior if file already exists")
			.setDesc(
				"Set default behavior rather then prompting user on what to do if a file already exists.",
			)
			.addToggle((toggle) => {
				toggle.setValue(this.choice.setFileExistsBehavior);
				toggle.onChange((value) => {
					this.choice.setFileExistsBehavior = value;
				});
			})
			.addDropdown((dropdown) => {
				dropdown.selectEl.style.marginLeft = "10px";

				if (!this.choice.fileExistsMode)
					this.choice.fileExistsMode = fileExistsDoNothing;

				dropdown
					.addOption(fileExistsAppendToBottom, fileExistsAppendToBottom)
					.addOption(fileExistsAppendToTop, fileExistsAppendToTop)
					.addOption(fileExistsIncrement, fileExistsIncrement)
					.addOption(fileExistsOverwriteFile, fileExistsOverwriteFile)
					.addOption(fileExistsDoNothing, fileExistsDoNothing)
					.setValue(this.choice.fileExistsMode)
					.onChange(
						(value: (typeof fileExistsChoices)[number]) =>
							(this.choice.fileExistsMode = value),
					);
			});
	}
}
