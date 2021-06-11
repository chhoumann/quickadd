import type IChoice from "./IChoice";
import type {NewTabDirection} from "../newTabDirection";

export default interface ITemplateChoice extends IChoice {
    templatePath: string;
    folder: { enabled: boolean, folders: string[] }
    fileNameFormat: { enabled: boolean, format: string };
    appendLink: boolean;
    incrementFileName: boolean;
    openFile: boolean;
    openFileInNewTab: {enabled: boolean, direction: NewTabDirection};
}