import {FuzzySuggestModal} from "obsidian";
import type IChoice from "../types/choices/IChoice";
import type QuickAdd from "../main";
import {ChoiceType} from "../types/choices/choiceType";
import type IMultiChoice from "../types/choices/IMultiChoice";
import {MultiChoice} from "../types/choices/MultiChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import {TemplateChoiceEngine} from "../engine/TemplateChoiceEngine";
import {log} from "../logger/logManager";
import {CaptureChoiceEngine} from "../engine/CaptureChoiceEngine";
import {MacroChoiceEngine} from "../engine/MacroChoiceEngine";

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
        switch (item.type) {
            case ChoiceType.Multi:
                const multiChoice: IMultiChoice = item as IMultiChoice;
                this.onChooseMultiType(multiChoice);
                break;
            case ChoiceType.Template:
                const templateChoice: ITemplateChoice = item as ITemplateChoice;
                await this.onChooseTemplateType(templateChoice);
                break;
            case ChoiceType.Capture:
                const captureChoice: ICaptureChoice = item as ICaptureChoice;
                await this.onChooseCaptureType(captureChoice);
                break;
            case ChoiceType.Macro:
                const macroChoice: IMacroChoice = item as IMacroChoice;
                await this.onChooseMacroType(macroChoice);
                break;
            default:
                break;
        }
    }

    private onChooseMultiType(multi: IMultiChoice) {
        const choices = [...multi.choices];

        if (multi.name != "← Back")
            choices.push(new MultiChoice("← Back").addChoices(this.choices))

        ChoiceSuggester.Open(this.plugin, choices);
    }

    private async onChooseTemplateType(templateChoice: ITemplateChoice): Promise<void> {
        if (!templateChoice.templatePath) {
            log.logError(`please provide a template path for ${templateChoice.name}`);
            return;
        }

        await new TemplateChoiceEngine(this.app, this.plugin, templateChoice).run();
    }

    private async onChooseCaptureType(captureChoice: ICaptureChoice) {
        if (!captureChoice.captureTo) {
            log.logError(`please provide a template path for ${captureChoice.name}`);
            return;
        }

        await new CaptureChoiceEngine(this.app, this.plugin, captureChoice).run();
    }

    private async onChooseMacroType(macroChoice: IMacroChoice) {
        if (macroChoice.macro.commands.length === 0) return;

        await new MacroChoiceEngine(this.app, macroChoice).run();
    }
}