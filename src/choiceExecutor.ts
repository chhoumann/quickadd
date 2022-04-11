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
import type {IChoiceExecutor} from "./IChoiceExecutor";
import type IMultiChoice from "./types/choices/IMultiChoice";
import ChoiceSuggester from "./gui/suggesters/choiceSuggester";

export class ChoiceExecutor implements IChoiceExecutor {
    public variables: Map<string, string> = new Map<string, string>();

    constructor(private app: App, private plugin: QuickAdd) { }

    async execute(choice: IChoice): Promise<void> {
        switch (choice.type) {
            case ChoiceType.Template:
                const templateChoice: ITemplateChoice = choice as ITemplateChoice;
                await this.onChooseTemplateType(templateChoice);
                break;
            case ChoiceType.Capture:
                const captureChoice: ICaptureChoice = choice as ICaptureChoice;
                await this.onChooseCaptureType(captureChoice);
                break;
            case ChoiceType.Macro:
                const macroChoice: IMacroChoice = choice as IMacroChoice;
                await this.onChooseMacroType(macroChoice);
                break;
            case ChoiceType.Multi:
                const multiChoice: IMultiChoice = choice as IMultiChoice;
                await this.onChooseMultiType(multiChoice);
                break
            default:
                break;
        }
    }

    private async onChooseTemplateType(templateChoice: ITemplateChoice): Promise<void> {
        if (!templateChoice.templatePath) {
            log.logError(`please provide a template path for ${templateChoice.name}`);
            return;
        }

        await new TemplateChoiceEngine(this.app, this.plugin, templateChoice, this).run();
    }

    private async onChooseCaptureType(captureChoice: ICaptureChoice) {
        if (!captureChoice.captureTo && !captureChoice?.captureToActiveFile) {
            log.logError(`please provide a capture path for ${captureChoice.name}`);
            return;
        }

        await new CaptureChoiceEngine(this.app, this.plugin, captureChoice, this).run();
    }

    private async onChooseMacroType(macroChoice: IMacroChoice) {
        const macroEngine = await new MacroChoiceEngine(this.app, this.plugin, macroChoice, this.plugin.settings.macros, this, this.variables);
        await macroEngine.run();

        Object.keys(macroEngine.params.variables).forEach(key => {
            this.variables.set(key, macroEngine.params.variables[key]);
        });
    }

    private async onChooseMultiType(multiChoice: IMultiChoice) {
        ChoiceSuggester.Open(this.plugin, multiChoice.choices, this);
    }
}