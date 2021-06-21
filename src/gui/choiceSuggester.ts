import {FuzzySuggestModal} from "obsidian";
import type IChoice from "../types/choices/IChoice";
import type QuickAdd from "../main";
import type IMultiChoice from "../types/choices/IMultiChoice";
import {MultiChoice} from "../types/choices/MultiChoice";
import {ChoiceType} from "../types/choices/choiceType";
import type {IChoiceExecutor} from "../IChoiceExecutor";
import {ChoiceExecutor} from "../choiceExecutor";

export default class ChoiceSuggester extends FuzzySuggestModal<IChoice> {
    private choiceExecutor: IChoiceExecutor = new ChoiceExecutor(this.app, this.plugin);

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
        if (item.type === ChoiceType.Multi)
            this.onChooseMultiType(<IMultiChoice>item);
        else
            await this.choiceExecutor.execute(item);
    }

    private onChooseMultiType(multi: IMultiChoice) {
        const choices = [...multi.choices];

        if (multi.name != "← Back")
            choices.push(new MultiChoice("← Back").addChoices(this.choices))

        ChoiceSuggester.Open(this.plugin, choices);
    }


}