import type {App} from "obsidian";
import type QuickAdd from "./main";
import type IChoice from "./types/choices/IChoice";
import {ChoiceType} from "./types/choices/choiceType";
import type ITemplateChoice from "./types/choices/ITemplateChoice";
import type ICaptureChoice from "./types/choices/ICaptureChoice";
import type IMacroChoice from "./types/choices/IMacroChoice";
import {log} from "./logger/logManager";
import {TemplateChoiceEngine} from "./engine/TemplateChoiceEngine";
import {CaptureChoiceEngine} from "./engine/CaptureChoiceEngine";
import {MacroChoiceEngine} from "./engine/MacroChoiceEngine";

export class ChoiceExecutor {
    constructor(private app: App, private plugin: QuickAdd, private choice: IChoice) { }

    public async execute(): Promise<void> {
        switch (this.choice.type) {
            case ChoiceType.Template:
                const templateChoice: ITemplateChoice = this.choice as ITemplateChoice;
                await this.onChooseTemplateType(templateChoice);
                break;
            case ChoiceType.Capture:
                const captureChoice: ICaptureChoice = this.choice as ICaptureChoice;
                await this.onChooseCaptureType(captureChoice);
                break;
            case ChoiceType.Macro:
                const macroChoice: IMacroChoice = this.choice as IMacroChoice;
                await this.onChooseMacroType(macroChoice);
                break;
            default:
                break;
        }
    }

    private async onChooseTemplateType(templateChoice: ITemplateChoice): Promise<void> {
        if (!templateChoice.templatePath) {
            log.logError(`please provide a template path for ${templateChoice.name}`);
            return;
        }

        await new TemplateChoiceEngine(this.app, this.plugin, templateChoice).run();
    }

    private async onChooseCaptureType(captureChoice: ICaptureChoice) {
        if (!captureChoice.captureTo && !captureChoice?.captureToActiveFile) {
            log.logError(`please provide a capture path for ${captureChoice.name}`);
            return;
        }

        await new CaptureChoiceEngine(this.app, this.plugin, captureChoice).run();
    }

    private async onChooseMacroType(macroChoice: IMacroChoice) {
        await new MacroChoiceEngine(this.app, macroChoice, this.plugin.settings.macros).run();
    }
}