import {FuzzySuggestModal} from "obsidian";
import type IChoice from "../types/choices/IChoice";
import type QuickAdd from "../main";
import {ChoiceType} from "../types/choices/choiceType";
import type IMultiChoice from "../types/choices/IMultiChoice";
import {MultiChoice} from "../types/choices/MultiChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";

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

    onChooseItem(item: IChoice, evt: MouseEvent | KeyboardEvent): void {
        switch (item.type) {
            case ChoiceType.Multi:
                const multiChoice: IMultiChoice = item as IMultiChoice;
                this.chooseMultiType(multiChoice);
                break;
            case ChoiceType.Template:
                const templateChoice: ITemplateChoice = item as ITemplateChoice;
                this.chooseTemplateType(templateChoice);
                break;
            case ChoiceType.Capture:
                const captureChoice: ICaptureChoice = item as ICaptureChoice;
                this.chooseCaptureType(captureChoice);
                break;
            case ChoiceType.Macro:
                const macroChoice: IMacroChoice = item as IMacroChoice;
                this.chooseMacroType(macroChoice);
                break;
            default:
                break;
        }
    }

    private chooseMultiType(multi: IMultiChoice) {
        const choices = [...multi.choices];

        if (multi.name != "← Back")
            choices.push(new MultiChoice("← Back").addChoices(this.choices))

        ChoiceSuggester.Open(this.plugin, choices);
    }

    private chooseTemplateType(templateChoice: ITemplateChoice) {
        if (!templateChoice.templatePath) return;
    }

    private chooseCaptureType(captureChoice: ICaptureChoice) {
        if (!captureChoice.captureTo) return;
    }

    private chooseMacroType(macroChoice: IMacroChoice) {
        if (macroChoice.macro.commands.length === 0) return;
    }
}