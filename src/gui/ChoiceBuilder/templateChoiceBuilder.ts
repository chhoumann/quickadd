import {ChoiceBuilder} from "./choiceBuilder";
import {App, Setting, TextAreaComponent, TextComponent} from "obsidian";
import type ITemplateChoice from "../../types/choices/ITemplateChoice";
import {GenericTextSuggester} from "../genericTextSuggester";
import {FormatSyntaxSuggester} from "../formatSyntaxSuggester";
import {FILE_NAME_FORMAT_SYNTAX} from "../../constants";

export class TemplateChoiceBuilder extends ChoiceBuilder {
    choice: ITemplateChoice;

    constructor(app: App, choice: ITemplateChoice) {
        super(app);
        this.choice = choice;

        this.display();
    }

    protected display() {
        this.addCenteredHeader(this.choice.name);
        this.addTemplatePathSetting();
        this.addFileNameFormatSetting();
        this.addFolderSetting();
        this.addAppendLinkSetting();
        this.addIncrementFileNameSetting();
        this.addNoOpenSetting();
        this.addNewTabSetting();
    }

    private addTemplatePathSetting(): void {
        new Setting(this.contentEl)
            .setName('Template Path')
            .setDesc('Path to the Template.')
            .addSearch(searchComponent => {
                searchComponent.setValue(this.choice.templatePath);

                const markdownFiles = this.app.vault.getMarkdownFiles().map(f => f.path)
                new GenericTextSuggester(this.app, searchComponent.inputEl, markdownFiles);

                searchComponent.onChange(value => {
                    this.choice.templatePath = value;
                })
            });
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

        const formatInput = new TextComponent(this.contentEl);
        textField = formatInput;
        formatInput.inputEl.style.width = "100%";
        formatInput.setValue(this.choice.fileNameFormat.format)
                .setDisabled(!this.choice.fileNameFormat.enabled)
                .onChange(value => this.choice.fileNameFormat.format = value);

        new FormatSyntaxSuggester(this.app, textField.inputEl, FILE_NAME_FORMAT_SYNTAX);
    }

    private addFolderSetting(): void {}

    private addAppendLinkSetting(): void {}

    private addIncrementFileNameSetting(): void {}

    private addNoOpenSetting(): void {}

    private addNewTabSetting(): void {}
}