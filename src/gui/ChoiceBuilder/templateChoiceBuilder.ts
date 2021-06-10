import {ChoiceBuilder} from "./choiceBuilder";
import {App, Setting} from "obsidian";
import type ITemplateChoice from "../../types/choices/ITemplateChoice";
import {GenericTextSuggester} from "../genericTextSuggester";

export class TemplateChoiceBuilder extends ChoiceBuilder {
    choice: ITemplateChoice;

    constructor(app: App, choice: ITemplateChoice) {
        super(app);
        this.choice = choice;

        this.display();
    }

    protected display() {
        this.addTemplatePathSetting();
    }

    private addTemplatePathSetting(): void {
        new Setting(this.contentEl)
            .setName('Template Path')
            .setDesc('Path to the Template.')
            .addSearch(searchComponent => {
                console.log()
                searchComponent.setValue(this.choice.templatePath);

                const markdownFiles = this.app.vault.getMarkdownFiles().map(f => f.path)
                const suggester = new GenericTextSuggester(this.app, searchComponent.inputEl, markdownFiles);

                searchComponent.onChange(value => {
                    this.choice.templatePath = value;
                })
            });
    }

}