import {ChoiceBuilder} from "./choiceBuilder";
import type ICaptureChoice from "../../types/choices/ICaptureChoice";
import type {App} from "obsidian";
import {Setting, TextAreaComponent, TextComponent, ToggleComponent} from "obsidian";
import {
    CREATE_IF_NOT_FOUND_BOTTOM,
    CREATE_IF_NOT_FOUND_TOP,
    FILE_NAME_FORMAT_SYNTAX,
    FORMAT_SYNTAX
} from "../../constants";
import {FormatDisplayFormatter} from "../../formatters/formatDisplayFormatter";
import type QuickAdd from "../../main";
import {FileNameDisplayFormatter} from "../../formatters/fileNameDisplayFormatter";
import {getTemplatePaths} from "../../utility";
import {NewTabDirection} from "../../types/newTabDirection";
import type {FileViewMode} from "../../types/fileViewMode";
import {GenericTextSuggester} from "../suggesters/genericTextSuggester";
import {FormatSyntaxSuggester} from "../suggesters/formatSyntaxSuggester";

export class CaptureChoiceBuilder extends ChoiceBuilder {
    choice: ICaptureChoice;

    constructor(app: App, choice: ICaptureChoice, private plugin: QuickAdd) {
        super(app);
        this.choice = choice;

        this.display();
    }

    protected display() {
        this.containerEl.addClass("captureChoiceBuilder");
        this.contentEl.empty();

        this.addCenteredChoiceNameHeader(this.choice);
        this.addCapturedToSetting();
        if (!this.choice?.captureToActiveFile) {
            this.addCreateIfNotExistsSetting();
            if (this.choice?.createFileIfItDoesntExist?.enabled)
                this.addCreateWithTemplateSetting();
        }

        this.addTaskSetting();
        this.addPrependSetting();

        if (!this.choice.captureToActiveFile) {
            this.addAppendLinkSetting();
            this.addInsertAfterSetting();
            this.addOpenFileSetting();
            if (this.choice.openFile)
                this.addOpenFileInNewTabSetting();
        }

        this.addFormatSetting();
    }

    private addCapturedToSetting() {
        let textField: TextComponent;
        const captureToSetting: Setting = new Setting(this.contentEl)
            .setName('Capture To')
            .setDesc('File to capture to. Supports some format syntax.');

        const captureToContainer: HTMLDivElement = this.contentEl.createDiv('captureToContainer');

        const captureToActiveFileContainer: HTMLDivElement = captureToContainer.createDiv('captureToActiveFileContainer');
        const captureToActiveFileText: HTMLSpanElement = captureToActiveFileContainer.createEl('span');
        captureToActiveFileText.textContent = "Capture to active file";
        const captureToActiveFileToggle: ToggleComponent = new ToggleComponent(captureToActiveFileContainer);
        captureToActiveFileToggle.setValue(this.choice?.captureToActiveFile);
        captureToActiveFileToggle.onChange(value => {
            this.choice.captureToActiveFile = value;

            this.reload();
        });

        if (!this.choice?.captureToActiveFile) {
            const captureToFileContainer: HTMLDivElement = captureToContainer.createDiv('captureToFileContainer');

            const formatDisplay: HTMLSpanElement = captureToFileContainer.createEl('span');
            const displayFormatter: FileNameDisplayFormatter = new FileNameDisplayFormatter(this.app);
            (async () => formatDisplay.textContent = await displayFormatter.format(this.choice.captureTo))();

            const formatInput = new TextComponent(captureToFileContainer);
            formatInput.setPlaceholder("File name format");
            textField = formatInput;
            formatInput.inputEl.style.width = "100%";
            formatInput.inputEl.style.marginBottom = "8px";
            formatInput.setValue(this.choice.captureTo)
                .setDisabled(this.choice?.captureToActiveFile)
                .onChange(async value => {
                    this.choice.captureTo = value;
                    formatDisplay.textContent = await displayFormatter.format(value);
                });

            const markdownFilesAndFormatSyntax = [...this.app.vault.getMarkdownFiles().map(f => f.path), ...FILE_NAME_FORMAT_SYNTAX];
            new GenericTextSuggester(this.app, textField.inputEl, markdownFilesAndFormatSyntax);
        }
    }

    private addPrependSetting() {
        const prependSetting: Setting = new Setting(this.contentEl);
        prependSetting.setName("Write to bottom of file")
            .setDesc(`Put value at the bottom of the file - otherwise at the ${this.choice?.captureToActiveFile ? "active cursor location" : "top"}.`)
            .addToggle(toggle => {
                toggle.setValue(this.choice.prepend);
                toggle.onChange(value => this.choice.prepend = value);
            });
    }

    private addTaskSetting() {
        const taskSetting: Setting = new Setting(this.contentEl);
        taskSetting.setName("Task")
            .setDesc("Formats the value as a task.")
            .addToggle(toggle => {
                toggle.setValue(this.choice.task);
                toggle.onChange(value => this.choice.task = value);
            });
    }

    private addAppendLinkSetting() {
        const appendLinkSetting: Setting = new Setting(this.contentEl);
        appendLinkSetting.setName("Append link")
            .setDesc("Add a link on your current cursor position, linking to the file you're capturing to.")
            .addToggle(toggle => {
                toggle.setValue(this.choice.appendLink);
                toggle.onChange(value => this.choice.appendLink = value);
            });
    }

    private addInsertAfterSetting() {
        let insertAfterInput: TextComponent;
        const insertAfterSetting: Setting = new Setting(this.contentEl);
        insertAfterSetting.setName("Insert after")
            .setDesc("Insert capture after specified line. Accepts format syntax.")
            .addToggle(toggle => {
                toggle.setValue(this.choice.insertAfter.enabled);
                toggle.onChange(value => {
                    this.choice.insertAfter.enabled = value;
                    insertAfterInput.setDisabled(!value);
                    this.reload();
                });
            })


        const insertAfterFormatDisplay: HTMLSpanElement = this.contentEl.createEl('span');
        const displayFormatter: FormatDisplayFormatter = new FormatDisplayFormatter(this.app, this.plugin);
        (async () => insertAfterFormatDisplay.innerText = await displayFormatter.format(this.choice.insertAfter.after))();

        insertAfterInput = new TextComponent(this.contentEl);
        insertAfterInput.setPlaceholder("Insert after");
        insertAfterInput.inputEl.style.width = "100%";
        insertAfterInput.inputEl.style.marginBottom = "8px";
        insertAfterInput.setValue(this.choice.insertAfter.after)
            .setDisabled(!this.choice.insertAfter.enabled)
            .onChange(async value => {
                this.choice.insertAfter.after = value;
                insertAfterFormatDisplay.innerText = await displayFormatter.format(value);
            });

        new FormatSyntaxSuggester(this.app, insertAfterInput.inputEl, this.plugin);

        if (this.choice.insertAfter.enabled) {
            const insertAtEndSetting: Setting = new Setting(this.contentEl);
            insertAtEndSetting.setName("Insert at end of section")
                .setDesc("Insert the text at the end of the section, rather than at the top.")
                .addToggle(toggle => toggle
                    .setValue(this.choice.insertAfter?.insertAtEnd)
                    .onChange(value => this.choice.insertAfter.insertAtEnd = value)
                );

            const createLineIfNotFound: Setting = new Setting(this.contentEl);
            createLineIfNotFound.setName("Create line if not found")
                .setDesc("Creates the 'insert after' line if it is not found.")
                .addToggle(toggle => {
                    if (!this.choice.insertAfter?.createIfNotFound)
                        this.choice.insertAfter.createIfNotFound = false; // Set to default

                    toggle
                            .setValue(this.choice.insertAfter?.createIfNotFound)
                            .onChange(value => this.choice.insertAfter.createIfNotFound = value)
                            .toggleEl.style.marginRight = "1em"
                    }
                )
                .addDropdown(dropdown => {
                    if (!this.choice.insertAfter?.createIfNotFoundLocation)
                        this.choice.insertAfter.createIfNotFoundLocation = CREATE_IF_NOT_FOUND_TOP; // Set to default

                    dropdown
                            .addOption(CREATE_IF_NOT_FOUND_TOP, "Top")
                            .addOption(CREATE_IF_NOT_FOUND_BOTTOM, "Bottom")
                            .setValue(this.choice.insertAfter?.createIfNotFoundLocation)
                            .onChange(value => this.choice.insertAfter.createIfNotFoundLocation = value)
                    }
                )
        }
    }

    private addFormatSetting() {
        let textField: TextAreaComponent;
        const enableSetting = new Setting(this.contentEl);
        enableSetting.setName("Capture format")
            .setDesc("Set the format of the capture.")
            .addToggle(toggleComponent => {
                toggleComponent.setValue(this.choice.format.enabled)
                    .onChange(value => {
                        this.choice.format.enabled = value;
                        textField.setDisabled(!value);
                    })
            });

        const formatInput = new TextAreaComponent(this.contentEl);
        formatInput.setPlaceholder("Format");
        textField = formatInput;
        formatInput.inputEl.style.width = "100%";
        formatInput.inputEl.style.marginBottom = "8px";
        formatInput.inputEl.style.height = "10rem";
        formatInput.setValue(this.choice.format.format)
            .setDisabled(!this.choice.format.enabled)
            .onChange(async value => {
                this.choice.format.format = value;
                formatDisplay.innerText = await displayFormatter.format(value);
            });

        new FormatSyntaxSuggester(this.app, textField.inputEl, this.plugin);

        const formatDisplay: HTMLSpanElement = this.contentEl.createEl('span');
        const displayFormatter: FormatDisplayFormatter = new FormatDisplayFormatter(this.app, this.plugin);
        (async () => formatDisplay.innerText = await displayFormatter.format(this.choice.format.format))();
    }

    private addCreateIfNotExistsSetting() {
        if (!this.choice.createFileIfItDoesntExist)
            this.choice.createFileIfItDoesntExist = {enabled: false, createWithTemplate: false, template: ""};

        const createFileIfItDoesntExist: Setting = new Setting(this.contentEl);
        createFileIfItDoesntExist
            .setName("Create file if it doesn't exist")
            .addToggle(toggle => toggle
                .setValue(this.choice?.createFileIfItDoesntExist?.enabled)
                .setTooltip("Create file if it doesn't exist")
                .onChange(value => {
                    this.choice.createFileIfItDoesntExist.enabled = value
                    this.reload();
                })
            );
    }

    private addCreateWithTemplateSetting() {
        let templateSelector: TextComponent;
        const createWithTemplateSetting = new Setting(this.contentEl);
        createWithTemplateSetting.setName("Create file with given template.")
            .addToggle(toggle => toggle.setValue(this.choice.createFileIfItDoesntExist?.createWithTemplate)
                .onChange(value => {
                    this.choice.createFileIfItDoesntExist.createWithTemplate = value
                    templateSelector.setDisabled(!value);
                }));

        templateSelector = new TextComponent(this.contentEl);
        templateSelector.setValue(this.choice?.createFileIfItDoesntExist?.template ?? "")
            .setPlaceholder("Template path")
            .setDisabled(!this.choice?.createFileIfItDoesntExist?.createWithTemplate);

        templateSelector.inputEl.style.width = "100%";
        templateSelector.inputEl.style.marginBottom = "8px";

        const markdownFiles: string[] = getTemplatePaths(this.app);
        new GenericTextSuggester(this.app, templateSelector.inputEl, markdownFiles);

        templateSelector.onChange(value => {
            this.choice.createFileIfItDoesntExist.template = value;
        });
    }


    private addOpenFileSetting(): void {
        const noOpenSetting: Setting = new Setting(this.contentEl);
        noOpenSetting.setName("Open")
            .setDesc("Open the file that is captured to.")
            .addToggle(toggle => {
                toggle.setValue(this.choice.openFile);
                toggle.onChange(value => {
                    this.choice.openFile = value;
                    this.reload();
                });
            })
            .addDropdown(dropdown => {
                    dropdown.selectEl.style.marginLeft = "10px";

                    if (!this.choice.openFileInMode)
                        this.choice.openFileInMode = 'default';

                    dropdown
                        .addOption('source', 'Source')
                        .addOption('preview', 'Preview')
                        .addOption('default', 'Default')
                        .setValue(this.choice.openFileInMode)
                        .onChange(value => this.choice.openFileInMode = (value as FileViewMode))
                }
            );
    }

    private addOpenFileInNewTabSetting(): void {
        const newTabSetting = new Setting(this.contentEl);
        newTabSetting.setName("New Tab")
            .setDesc("Open the file that is captured to in a new tab.")
            .addToggle(toggle => {
                toggle.setValue(this.choice?.openFileInNewTab?.enabled);
                toggle.onChange(value => this.choice.openFileInNewTab.enabled = value);
            })
            .addDropdown(dropdown => {
                if (!this.choice?.openFileInNewTab) {
                    this.choice.openFileInNewTab = { enabled: false, direction: NewTabDirection.vertical, focus: true };
                }

                dropdown.selectEl.style.marginLeft = "10px";
                dropdown.addOption(NewTabDirection.vertical, "Vertical");
                dropdown.addOption(NewTabDirection.horizontal, "Horizontal");
                dropdown.setValue(this.choice?.openFileInNewTab?.direction);
                dropdown.onChange(value => this.choice.openFileInNewTab.direction = <NewTabDirection>value);
            });

        new Setting(this.contentEl)
            .setName("Focus new pane")
            .setDesc("Focus the opened tab immediately")
            .addToggle(toggle => toggle
                .setValue(this.choice.openFileInNewTab.focus)
                .onChange(value => this.choice.openFileInNewTab.focus = value)
            );
    }
}