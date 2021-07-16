import {ChoiceType} from "./choiceType";
import type ITemplateChoice from "./ITemplateChoice";
import {Choice} from "./Choice";
import {NewTabDirection} from "../newTabDirection";

export class TemplateChoice extends Choice implements ITemplateChoice {
    appendLink: boolean;
    fileNameFormat: { enabled: boolean; format: string };
    folder: { enabled: boolean; folders: string[], chooseWhenCreatingNote: boolean, createInSameFolderAsActiveFile: boolean };
    incrementFileName: boolean;
    openFileInNewTab: { enabled: boolean; direction: NewTabDirection };
    openFile: boolean;
    templatePath: string;

    constructor(name: string) {
        super(name, ChoiceType.Template);

        this.templatePath = "";
        this.fileNameFormat = {enabled: false, format: ""};
        this.folder = {enabled: false, folders: [], chooseWhenCreatingNote: false, createInSameFolderAsActiveFile: false};
        this.openFileInNewTab = {enabled: false, direction: NewTabDirection.vertical};
        this.appendLink = false;
        this.incrementFileName = false;
        this.openFile = false;
    }

    public static Load(choice: ITemplateChoice): TemplateChoice {
        return choice as TemplateChoice;
    }
}