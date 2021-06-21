import {ChoiceBuilder} from "./choiceBuilder";
import type IMacroChoice from "../../types/choices/IMacroChoice";
import type {App} from "obsidian";
import {DropdownComponent, Setting} from "obsidian";
import {GenericTextSuggester} from "../genericTextSuggester";
import type {IMacro} from "../../types/macros/IMacro";

export class MacroChoiceBuilder extends ChoiceBuilder {
    choice: IMacroChoice;

    constructor(app: App, choice: IMacroChoice, private macros: IMacro[]) {
        super(app);
        this.choice = choice;

        this.display();
    }

    protected display() {
        this.addCenteredChoiceNameHeader(this.choice);
        this.addSelectMacroSearch();
    }

    private addSelectMacroSearch() {
        const selectMacroDropdownContainer: HTMLDivElement = this.contentEl.createDiv('selectMacroDropdownContainer');
        const dropdown: DropdownComponent = new DropdownComponent(selectMacroDropdownContainer);

        let macroOptions: Record<string, string> = {};

        this.macros.forEach(macro => {
            macroOptions[macro.name] = macro.name;
        });

        dropdown.addOptions(macroOptions);
        dropdown.onChange(value => {
            const targetMacro: IMacro = this.macros.find(m => m.name === value);
            if (!targetMacro) return;

            this.choice.macroId = targetMacro.id;
        });

        const selectedMacro: IMacro = this.macros.find(m => m.id === this.choice.macroId);
        if (selectedMacro) dropdown.setValue(selectedMacro.name);
    }
}