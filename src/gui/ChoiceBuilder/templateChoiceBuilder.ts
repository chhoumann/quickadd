import { ChoiceBuilder } from "./choiceBuilder";
import type { App } from "obsidian";
import {
	ButtonComponent,
	Setting,
	TextComponent,
	ToggleComponent,
} from "obsidian";
import type ITemplateChoice from "../../types/choices/ITemplateChoice";
import { NewTabDirection } from "../../types/newTabDirection";
import FolderList from "./FolderList.svelte";
import { FileNameDisplayFormatter } from "../../formatters/fileNameDisplayFormatter";
import { log } from "../../logger/logManager";
import { getAllFolderPathsInVault } from "../../utilityObsidian";
import type QuickAdd from "../../main";
import type { FileViewMode } from "../../types/fileViewMode";
import { GenericTextSuggester } from "../suggesters/genericTextSuggester";
import { FormatSyntaxSuggester } from "../suggesters/formatSyntaxSuggester";
import { ExclusiveSuggester } from "../suggesters/exclusiveSuggester";
import type { fileExistsChoices } from "src/constants";
import {
	fileExistsAppendToBottom,
	fileExistsAppendToTop,
	fileExistsDoNothing,
	fileExistsIncrement,
	fileExistsOverwriteFile,
} from "src/constants";

export class TemplateChoiceBuilder extends ChoiceBuilder {
	choice: ITemplateChoice;

	constructor(app: App, choice: ITemplateChoice, private plugin: QuickAdd) {
		super(app);
		this.choice = choice;

		this.display();
	}

	protected display() {
		this.containerEl.addClass("templateChoiceBuilder");
		this.addCenteredChoiceNameHeader(this.choice);
		this.addTemplatePathSetting();
		this.addFileNameFormatSetting();
		this.addFolderSetting();
		this.addAppendLinkSetting();
		this.addFileAlreadyExistsSetting();
		this.addOpenFileSetting();
		if (this.choice.openFile) this.addOpenFileInNewTabSetting();
	}

	private addTemplatePathSetting(): void {
		new Setting(this.contentEl)
			.setName("Template Path")
			.setDesc("Path to the Template.")
			.addSearch((search) => {
				const templates: string[] = this.plugin
					.getTemplateFiles()
					.map((f) => f.path);
				search.setValue(this.choice.templatePath);
				search.setPlaceholder("Template path");

				new GenericTextSuggester(this.app, search.inputEl, templates, 50);

				search.onChange((value) => {
					this.choice.templatePath = value;
				});
			});
	}

	private addFileNameFormatSetting(): void {
		// eslint-disable-next-line prefer-const
		let textField: TextComponent;
		const enableSetting = new Setting(this.contentEl);
		enableSetting
			.setName("File Name Format")
			.setDesc("Set the file name format.")
			.addToggle((toggleComponent) => {
				toggleComponent
					.setValue(this.choice.fileNameFormat.enabled)
					.onChange((value) => {
						this.choice.fileNameFormat.enabled = value;
						textField.setDisabled(!value);
					});
			});

		const formatDisplay: HTMLSpanElement = this.contentEl.createEl("span");
		const displayFormatter: FileNameDisplayFormatter =
			new FileNameDisplayFormatter(this.app);
		void (async () =>
			(formatDisplay.textContent = await displayFormatter.format(
				this.choice.fileNameFormat.format
			)))();

		const formatInput = new TextComponent(this.contentEl);
		formatInput.setPlaceholder("File name format");
		textField = formatInput;
		formatInput.inputEl.style.width = "100%";
		formatInput.inputEl.style.marginBottom = "8px";
		formatInput
			.setValue(this.choice.fileNameFormat.format)
			.setDisabled(!this.choice.fileNameFormat.enabled)
			.onChange(async (value) => {
				this.choice.fileNameFormat.format = value;
				formatDisplay.textContent = await displayFormatter.format(
					value
				);
			});

		new FormatSyntaxSuggester(
			this.app,
			textField.inputEl,
			this.plugin,
			true
		);
	}

	private addFolderSetting(): void {
		const folderSetting: Setting = new Setting(this.contentEl);
		folderSetting
			.setName("Create in folder")
			.setDesc(
				"Create the file in the specified folder. If multiple folders are specified, you will be prompted for which folder to create the file in."
			)
			.addToggle((toggle) => {
				toggle.setValue(this.choice.folder.enabled);
				toggle.onChange((value) => {
					this.choice.folder.enabled = value;
					this.reload();
				});
			});

		if (!this.choice.folder.enabled) {
			return;
		}

		if (!this.choice.folder?.createInSameFolderAsActiveFile) {
			const chooseFolderWhenCreatingNoteContainer =
				this.contentEl.createDiv(
					"chooseFolderWhenCreatingNoteContainer"
				);
			chooseFolderWhenCreatingNoteContainer.createEl("span", {
				text: "Choose folder when creating a new note",
			});
			const chooseFolderWhenCreatingNote: ToggleComponent =
				new ToggleComponent(chooseFolderWhenCreatingNoteContainer);
			chooseFolderWhenCreatingNote
				.setValue(this.choice.folder?.chooseWhenCreatingNote)
				.onChange((value) => {
					this.choice.folder.chooseWhenCreatingNote = value;
					this.reload();
				});

			if (!this.choice.folder?.chooseWhenCreatingNote) {
				this.addFolderSelector();
			}

			const chooseFolderFromSubfolderContainer: HTMLDivElement =
				this.contentEl.createDiv("chooseFolderFromSubfolderContainer");

			const stn = new Setting(chooseFolderFromSubfolderContainer);
			stn.setName("Include subfolders")
				.setDesc(
					"Get prompted to choose from both the selected folders and their subfolders when creating the note."
				)
				.addToggle((toggle) =>
					toggle
						.setValue(this.choice.folder?.chooseFromSubfolders)
						.onChange((value) => {
							this.choice.folder.chooseFromSubfolders = value;
							this.reload();
						})
				);
		}

		if (!this.choice.folder?.chooseWhenCreatingNote) {
			const createInSameFolderAsActiveFileSetting: Setting = new Setting(
				this.contentEl
			);
			createInSameFolderAsActiveFileSetting
				.setName("Create in same folder as active file")
				.setDesc(
					"Creates the file in the same folder as the currently active file. Will not create the file if there is no active file."
				)
				.addToggle((toggle) =>
					toggle
						.setValue(
							this.choice.folder?.createInSameFolderAsActiveFile
						)
						.onChange((value) => {
							this.choice.folder.createInSameFolderAsActiveFile =
								value;
							this.reload();
						})
				);
		}
	}

	private addFolderSelector() {
		const folderSelectionContainer: HTMLDivElement =
			this.contentEl.createDiv("folderSelectionContainer");
		const folderList: HTMLDivElement =
			folderSelectionContainer.createDiv("folderList");

		const folderListEl = new FolderList({
			target: folderList,
			props: {
				folders: this.choice.folder.folders,
				deleteFolder: (folder: string) => {
					this.choice.folder.folders =
						this.choice.folder.folders.filter((f) => f !== folder);
					// eslint-disable-next-line @typescript-eslint/no-unsafe-call
					folderListEl.updateFolders(this.choice.folder.folders);
					suggester.updateCurrentItems(this.choice.folder.folders);
				},
			},
		});

		this.svelteElements.push(folderListEl);

		const inputContainer = folderSelectionContainer.createDiv(
			"folderInputContainer"
		);
		const folderInput = new TextComponent(inputContainer);
		folderInput.inputEl.style.width = "100%";
		folderInput.setPlaceholder("Folder path");
		const allFolders: string[] = getAllFolderPathsInVault(this.app);

		const suggester = new ExclusiveSuggester(
			this.app,
			folderInput.inputEl,
			allFolders,
			this.choice.folder.folders
		);

		const addFolder = () => {
			const input = folderInput.inputEl.value.trim();

			if (this.choice.folder.folders.some((folder) => folder === input)) {
				log.logWarning("cannot add same folder twice.");
				return;
			}

			this.choice.folder.folders.push(input);
			// eslint-disable-next-line @typescript-eslint/no-unsafe-call
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
		const appendLinkSetting: Setting = new Setting(this.contentEl);
		appendLinkSetting
			.setName("Append link")
			.setDesc("Append link to created file to current file.")
			.addToggle((toggle) => {
				toggle.setValue(this.choice.appendLink);
				toggle.onChange((value) => (this.choice.appendLink = value));
			});
	}

	private addFileAlreadyExistsSetting(): void {
		const fileAlreadyExistsSetting: Setting = new Setting(this.contentEl);
		fileAlreadyExistsSetting
			.setName("Set default behavior if file already exists")
			.setDesc(
				"Set default behavior rather then prompting user on what to do if a file already exists."
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
					.addOption(
						fileExistsAppendToBottom,
						fileExistsAppendToBottom
					)
					.addOption(fileExistsAppendToTop, fileExistsAppendToTop)
					.addOption(fileExistsIncrement, fileExistsIncrement)
					.addOption(fileExistsOverwriteFile, fileExistsOverwriteFile)
					.addOption(fileExistsDoNothing, fileExistsDoNothing)
					.setValue(this.choice.fileExistsMode)
					.onChange(
						(value: typeof fileExistsChoices[number]) =>
							(this.choice.fileExistsMode = value)
					);
			});
	}

	private addOpenFileSetting(): void {
		const noOpenSetting: Setting = new Setting(this.contentEl);
		noOpenSetting
			.setName("Open")
			.setDesc("Open the created file.")
			.addToggle((toggle) => {
				toggle.setValue(this.choice.openFile);
				toggle.onChange((value) => {
					this.choice.openFile = value;
					this.reload();
				});
			})
			.addDropdown((dropdown) => {
				dropdown.selectEl.style.marginLeft = "10px";

				if (!this.choice.openFileInMode)
					this.choice.openFileInMode = "default";

				dropdown
					.addOption("source", "Source")
					.addOption("preview", "Preview")
					.addOption("default", "Default")
					.setValue(this.choice.openFileInMode)
					.onChange(
						(value) =>
							(this.choice.openFileInMode = value as FileViewMode)
					);
			});
	}

	private addOpenFileInNewTabSetting(): void {
		const newTabSetting = new Setting(this.contentEl);
		newTabSetting
			.setName("New split")
			.setDesc("Split your editor and open file in new split.")
			.addToggle((toggle) => {
				toggle.setValue(this.choice.openFileInNewTab.enabled);
				toggle.onChange(
					(value) => (this.choice.openFileInNewTab.enabled = value)
				);
			})
			.addDropdown((dropdown) => {
				dropdown.selectEl.style.marginLeft = "10px";
				dropdown.addOption(NewTabDirection.vertical, "Vertical");
				dropdown.addOption(NewTabDirection.horizontal, "Horizontal");
				dropdown.setValue(this.choice.openFileInNewTab.direction);
				dropdown.onChange(
					(value) =>
						(this.choice.openFileInNewTab.direction = <
							NewTabDirection
						>value)
				);
			});

		new Setting(this.contentEl)
			.setName("Focus new pane")
			.setDesc("Focus the opened tab immediately after opening")
			.addToggle((toggle) =>
				toggle
					.setValue(this.choice.openFileInNewTab.focus)
					.onChange(
						(value) => (this.choice.openFileInNewTab.focus = value)
					)
			);
	}
}
