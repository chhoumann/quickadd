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
    templatePath: string;

    constructor(name: string) {
        super(name, ChoiceType.Template);

        this.fileNameFormat = {enabled: false, format: ""};
        this.folder = {enabled: false, folders: []};
        this.newTab = {enabled: false, direction: "vertical"};
        this.appendLink = false;
        this.incrementFileName = false;
        this.noOpen = false;
    }

    public static Load(choice: ITemplateChoice): TemplateChoice {
        return choice as TemplateChoice;
    }
}