import {ChoiceBuilder} from "./choiceBuilder";
import type ICaptureChoice from "../../types/choices/ICaptureChoice";
import type {App} from "obsidian";
import {Setting, TextAreaComponent, TextComponent, ToggleComponent} from "obsidian";
import {FormatSyntaxSuggester} from "../formatSyntaxSuggester";
import {FILE_NAME_FORMAT_SYNTAX, FORMAT_SYNTAX} from "../../constants";
import {FormatDisplayFormatter} from "../../formatters/formatDisplayFormatter";
import type QuickAdd from "../../main";
import {FileNameDisplayFormatter} from "../../formatters/fileNameDisplayFormatter";
import {GenericTextSuggester} from "../genericTextSuggester";
import {getTemplatePaths} from "../../utility";

export class CaptureChoiceBuilder extends ChoiceBuilder {
    choice: ICaptureChoice;

    constructor(app: App, choice: ICaptureChoice, private plugin: QuickAdd) {
        super(app);
        this.choice = choice;

        this.display();
    }

    protected display() {
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
        const insertAfterSetting: Setting = new Setting(this.contentEl);
        insertAfterSetting.setName("Insert after")
            .setDesc("Insert capture after specified line.")
            .addToggle(toggle => {
                toggle.setValue(this.choice.insertAfter.enabled);
                toggle.onChange(value => {
                    this.choice.insertAfter.enabled = value;
                    this.reload();
                });
            })
            .addText(textEl => {
                textEl.setPlaceholder("Line text");
                textEl.inputEl.style.marginLeft = "10px";
                textEl.setValue(this.choice.insertAfter.after);
                textEl.onChange(value => this.choice.insertAfter.after = value);
            });

        if (this.choice.insertAfter.enabled) {
            const insertAtEndSetting: Setting = new Setting(this.contentEl);
            insertAtEndSetting.setName("Insert at end of section")
                .setDesc("Insert the text at the end of the section, rather than at the top.")
                .addToggle(toggle => toggle
                    .setValue(this.choice.insertAfter?.insertAtEnd)
                    .onChange(value => this.choice.insertAfter.insertAtEnd = value)
                );
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
}