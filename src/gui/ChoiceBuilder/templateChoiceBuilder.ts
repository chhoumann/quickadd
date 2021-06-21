import {ChoiceBuilder} from "./choiceBuilder";
import {App, ButtonComponent, Setting, TextComponent, TFolder} from "obsidian";
import type ITemplateChoice from "../../types/choices/ITemplateChoice";
import {FormatSyntaxSuggester} from "../formatSyntaxSuggester";
import {FILE_NAME_FORMAT_SYNTAX} from "../../constants";
import {NewTabDirection} from "../../types/newTabDirection";
import FolderList from "./FolderList.svelte";
import {FileNameDisplayFormatter} from "../../formatters/fileNameDisplayFormatter";
import {ExclusiveSuggester} from "../exclusiveSuggester";
import {log} from "../../logger/logManager";
import {getTemplatePaths} from "../../utility";
import {GenericTextSuggester} from "../genericTextSuggester";

export class TemplateChoiceBuilder extends ChoiceBuilder {
    choice: ITemplateChoice;

    constructor(app: App, choice: ITemplateChoice) {
        super(app);
        this.choice = choice;

        this.display();
    }

    protected display() {
        this.addCenteredChoiceNameHeader(this.choice);
        this.addTemplatePathSetting();
        this.addFileNameFormatSetting();
        this.addFolderSetting();
        this.addAppendLinkSetting();
        this.addIncrementFileNameSetting();
        this.addOpenFileSetting();
        if (this.choice.openFile)
            this.addOpenFileInNewTabSetting();
    }

    private addTemplatePathSetting(): void {
        const templatePathSetting = new Setting(this.contentEl)
            .setName('Template Path')
            .setDesc('Path to the Template.')
            .addSearch(search => {
                const templates: string[] = getTemplatePaths(this.app);
                search.setValue(this.choice.templatePath);
                search.setPlaceholder("Template path");

                new GenericTextSuggester(this.app, search.inputEl, templates);

                search.onChange(value => {
                    this.choice.templatePath = value;
                })

            })
    }

    private addFileNameFormatSetting(): void {
        let textField: TextComponent;
        const enableSetting = new Setting(this.contentEl);
        enableSetting.setName("File Name Format")
            .setDesc("Set the file name format.")
            .addToggle(toggleComponent => {
                toggleComponent.setValue(this.choice.fileNameFormat.enabled)
                    .onChange(value => {
                        this.choice.fileNameFormat.enabled = value;
                        textField.setDisabled(!value);
                    })
            });

        const formatDisplay: HTMLSpanElement = this.contentEl.createEl('span');
        const displayFormatter: FileNameDisplayFormatter = new FileNameDisplayFormatter(this.app);
        (async () => formatDisplay.textContent = await displayFormatter.format(this.choice.fileNameFormat.format))();

        const formatInput = new TextComponent(this.contentEl);
        formatInput.setPlaceholder("File name format");
        textField = formatInput;
        formatInput.inputEl.style.width = "100%";
        formatInput.inputEl.style.marginBottom = "8px";
        formatInput.setValue(this.choice.fileNameFormat.format)
                .setDisabled(!this.choice.fileNameFormat.enabled)
                .onChange(async value => {
                    this.choice.fileNameFormat.format = value;
                    formatDisplay.textContent = await displayFormatter.format(value);
                });

        new FormatSyntaxSuggester(this.app, textField.inputEl, FILE_NAME_FORMAT_SYNTAX);
    }

    private addFolderSetting(): void {
        const folderSetting: Setting = new Setting(this.contentEl);
        folderSetting.setName("Create in folder")
            .setDesc("Create the file in the specified folder. If multiple folders are specified, you will be prompted for which folder to create the file in.")
            .addToggle(toggle => {
                toggle.setValue(this.choice.folder.enabled);
                toggle.onChange(value => this.choice.folder.enabled = value);
            });

        const folderList: HTMLDivElement = this.contentEl.createDiv('folderList');

        const folderListEl = new FolderList({
            target: folderList,
            props: {
                folders: this.choice.folder.folders,
                deleteFolder: (folder: string) => {
                    this.choice.folder.folders = this.choice.folder.folders.filter(f => f !== folder);
                    folderListEl.updateFolders(this.choice.folder.folders);
                    suggester.updateCurrentItems(this.choice.folder.folders);
                }
            }
        });

        this.svelteElements.push(folderListEl);

        const inputContainer = this.contentEl.createDiv('folderInputContainer');
        const folderInput = new TextComponent(inputContainer);
        folderInput.inputEl.style.width = "100%";
        folderInput.setPlaceholder("Folder path");
        const folders: string[] = this.app.vault.getAllLoadedFiles()
            .filter(f => f instanceof TFolder)
            .map(folder => folder.path);

        const suggester = new ExclusiveSuggester(this.app, folderInput.inputEl, folders, this.choice.folder.folders);

        const addFolder = () => {
            const input = folderInput.inputEl.value.trim();

            if (this.choice.folder.folders.some(folder => folder === input)) {
                log.logWarning("cannot add same folder twice.");
                return;
            }

            this.choice.folder.folders.push(input);
            folderListEl.updateFolders(this.choice.folder.folders);
            folderInput.inputEl.value = "";

            suggester.updateCurrentItems(this.choice.folder.folders);
        }

        folderInput.inputEl.addEventListener('keypress', (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                addFolder();
            }
        });

        const addButton: ButtonComponent = new ButtonComponent(inputContainer);
        addButton.setCta().setButtonText("Add").onClick(evt => {
            addFolder();
        });
    }

    private addAppendLinkSetting(): void {
        const appendLinkSetting: Setting = new Setting(this.contentEl);
        appendLinkSetting.setName("Append link")
            .setDesc("Append link to created file to current file.")
            .addToggle(toggle => {
                toggle.setValue(this.choice.appendLink);
                toggle.onChange(value => this.choice.appendLink = value);
            })
    }

    private addIncrementFileNameSetting(): void {
        const incrementFileNameSetting: Setting = new Setting(this.contentEl);
        incrementFileNameSetting.setName("Increment file name")
            .setDesc("If the file already exists, increment the file name.")
            .addToggle(toggle => {
                toggle.setValue(this.choice.incrementFileName);
                toggle.onChange(value => this.choice.incrementFileName = value);
            })
    }

    private addOpenFileSetting(): void {
        const noOpenSetting: Setting = new Setting(this.contentEl);
        noOpenSetting.setName("Open")
            .setDesc("Open the created file.")
            .addToggle(toggle => {
                toggle.setValue(this.choice.openFile);
                toggle.onChange(value => {
                    this.choice.openFile = value;
                    this.reload();
                });
            })
    }

    private addOpenFileInNewTabSetting(): void {
        const newTabSetting = new Setting(this.contentEl);
        newTabSetting.setName("New Tab")
            .setDesc("Open created file in a new tab.")
            .addToggle(toggle => {
                toggle.setValue(this.choice.openFileInNewTab.enabled);
                toggle.onChange(value => this.choice.openFileInNewTab.enabled = value);
            })
            .addDropdown(dropdown => {
                dropdown.selectEl.style.marginLeft = "10px";
                dropdown.addOption(NewTabDirection.vertical, "Vertical");
                dropdown.addOption(NewTabDirection.horizontal, "Horizontal");
                dropdown.setValue(this.choice.openFileInNewTab.direction);
                dropdown.onChange(value => this.choice.openFileInNewTab.direction = <NewTabDirection>value);
            });
    }
}