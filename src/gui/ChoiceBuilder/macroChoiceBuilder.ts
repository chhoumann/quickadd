import {ChoiceBuilder} from "./choiceBuilder";
import type IMacroChoice from "../../types/choices/IMacroChoice";
import type {App} from "obsidian";
import {Setting} from "obsidian";
import {GenericTextSuggester} from "../genericTextSuggester";
import type {IMacro} from "../../types/macros/IMacro";

export class MacroChoiceBuilder extends ChoiceBuilder {
    choice: IMacroChoice;
    selectedMacro: IMacro;
    private updateSelectedMacro: () => void;

    constructor(app: App, choice: IMacroChoice, private macros: IMacro[]) {
        super(app);
        this.choice = choice;

        this.display();
    }

    protected display() {
        this.addCenteredChoiceNameHeader(this.choice);
        this.addSelectedMacroElement();
        this.addSelectMacroSearch();
    }

    private addSelectedMacroElement() {
        const selectedMacroEl = this.contentEl.createEl('h3');
        selectedMacroEl.style.textAlign = "center";

        this.updateSelectedMacro = (() => {
            this.selectedMacro = this.macros.find(m => m.id === this.choice.macroId);

            if (this.selectedMacro)
                selectedMacroEl.textContent = `Selected macro: ${this.selectedMacro.name}`;
        });

        this.updateSelectedMacro();
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

                        this.choice.macroId = macro.id;
                        this.updateSelectedMacro();

                        searchComponent.setValue("");
                    }
                })
            })
        }

}