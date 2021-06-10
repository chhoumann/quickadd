import type IChoice from "./IChoice";

export default interface ITemplateChoice extends IChoice {
    templatePath: string;
    startSymbol: { enabled: boolean, symbol: string };
    folder: { enabled: boolean, folders: string[] }
    fileNameFormat: { enabled: boolean, format: string };
    appendLink: boolean;
    incrementFileName: boolean;
    noOpen: boolean;
    newTab: {enabled: boolean, direction: "vertical" | "horizontal"};
}