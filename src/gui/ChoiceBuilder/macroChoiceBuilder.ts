import {ChoiceBuilder} from "./choiceBuilder";
import type IMacroChoice from "../../types/choices/IMacroChoice";
import type {App} from "obsidian";
import {Setting} from "obsidian";
import {GenericTextSuggester} from "../genericTextSuggester";
import type {IMacro} from "../../types/macros/IMacro";

export class MacroChoiceBuilder extends ChoiceBuilder {
    choice: IMacroChoice;
    private updateSelectedMacro: (macro: IMacro) => void;

    constructor(app: App, choice: IMacroChoice, private macros: IMacro[]) {
        super(app);
        this.choice = choice;

        this.display();
    }

    protected display() {
        this.addCenteredHeader(this.choice.name);
        this.addSelectedMacroElement();
        this.addSelectMacroSearch();
    }

    private addSelectedMacroElement() {
        const selectedMacro = this.contentEl.createEl('h3');
        selectedMacro.style.textAlign = "center";

        this.updateSelectedMacro = (macro => {
            if (macro)
               selectedMacro.textContent = `Selected macro: ${macro.name}`;
        });

        this.updateSelectedMacro(this.choice.macro);
    }

    private addSelectMacroSearch() {
        new Setting(this.contentEl)
            .setName("Select macro")
            .addSearch(searchComponent => {
                searchComponent.setPlaceholder("Macro name");
                new GenericTextSuggester(this.app, searchComponent.inputEl, this.macros.map(m => m.name));

                searchComponent.inputEl.addEventListener('keypress', (e: KeyboardEvent) => {
                    if (e.key === 'Enter') {
                        const value: string = searchComponent.getValue();
                        const macro = this.macros.find(m => m.name === value);
                        if (!macro) return;

                        this.choice.macro = macro;
                        this.updateSelectedMacro(this.choice.macro);

                        searchComponent.setValue("");
                    }
                })
            })
        }

}