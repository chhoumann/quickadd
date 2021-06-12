import {ChoiceBuilder} from "./choiceBuilder";
import type ICaptureChoice from "../../types/choices/ICaptureChoice";
import type {App} from "obsidian";
import {Setting, TextAreaComponent} from "obsidian";
import {FormatSyntaxSuggester} from "../formatSyntaxSuggester";
import {FORMAT_SYNTAX} from "../../constants";
import {FormatDisplayFormatter} from "../../formatters/formatDisplayFormatter";
import type QuickAdd from "../../main";

export class CaptureChoiceBuilder extends ChoiceBuilder {
    choice: ICaptureChoice;

    constructor(app: App, choice: ICaptureChoice, private plugin: QuickAdd) {
        super(app);
        this.choice = choice;

        this.display();
    }

    protected display() {
        this.addCenteredHeader(this.choice.name);
        this.addCapturedToSetting();
        this.addPrependSetting();
        this.addTaskSetting();
        this.addAppendLinkSetting();
        this.addInsertAfterSetting();
        this.addFormatSetting();
    }

    private addCapturedToSetting() {
        const captureToSetting: Setting = new Setting(this.contentEl)
            .setName('Capture To')
            .setDesc('File to capture to. Supports some format syntax.');

        this.addFileSearchInputToSetting(captureToSetting, this.choice.captureTo, value => {
            this.choice.captureTo = value;
        });
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