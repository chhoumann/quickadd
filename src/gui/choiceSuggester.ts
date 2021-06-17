import {FuzzySuggestModal} from "obsidian";
import type IChoice from "../types/choices/IChoice";
import type QuickAdd from "../main";
import {ChoiceExecutor} from "../choiceExecutor";

export default class ChoiceSuggester extends FuzzySuggestModal<IChoice> {
    public static Open(plugin: QuickAdd, choices: IChoice[]) {
        new ChoiceSuggester(plugin, choices).open();
    }

    constructor(private plugin: QuickAdd, private choices: IChoice[]) {
        super(plugin.app);
    }

    getItemText(item: IChoice): string {
        return item.name;
    }

    getItems(): IChoice[] {
        return this.choices;
    }

    async onChooseItem(item: IChoice, evt: MouseEvent | KeyboardEvent): Promise<void> {
        await new ChoiceExecutor(this.app, this.plugin, item).execute();
    }


}