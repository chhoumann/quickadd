import {ChoiceType} from "./choiceType";
import type ITemplateChoice from "./ITemplateChoice";
import {Choice} from "./Choice";

export class TemplateChoice extends Choice implements ITemplateChoice {
    appendLink: boolean;
    fileNameFormat: { enabled: boolean; format: string };
    folder: { enabled: boolean; folders: string[] };
    incrementFileName: boolean;
    newTab: { enabled: boolean; direction: "vertical" | "horizontal" };
    noOpen: boolean;
    startSymbol: { enabled: boolean; symbol: string };
    templatePath: string;

    constructor(name: string) {
        super(name, ChoiceType.Template);
    }
}