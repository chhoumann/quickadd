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
        this.addTaskSetting();

        if (!this.choice.captureToActiveFile) {
            this.addPrependSetting();
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

            this.display();
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
        prependSetting.setName("Prepend")
            .setDesc("Put value at the bottom of the file - otherwise at the top.")
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
            .setDesc("Append a link to the open file in the capture.")
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
                toggle.onChange(value => this.choice.insertAfter.enabled = value);
            })
            .addText(textEl => {
                textEl.setPlaceholder("Line text");
                textEl.inputEl.style.marginLeft = "10px";
                textEl.setValue(this.choice.insertAfter.after);
                textEl.onChange(value => this.choice.insertAfter.after = value);
            });
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

        new FormatSyntaxSuggester(this.app, textField.inputEl, FORMAT_SYNTAX);

        const formatDisplay: HTMLSpanElement = this.contentEl.createEl('span');
        const displayFormatter: FormatDisplayFormatter = new FormatDisplayFormatter(this.app, this.plugin);
        (async () => formatDisplay.innerText = await displayFormatter.format(this.choice.format.format))();
    }
}