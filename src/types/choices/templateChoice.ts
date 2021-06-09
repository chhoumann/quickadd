import type {Choice} from "./choice";

export interface TemplateChoice extends Choice {
    templatePath: string;
    startSymbol: { enabled: boolean, symbol: string };
    folder: { enabled: boolean, folders: string[] }
    fileNameFormat: { enabled: boolean, format: string };
    appendLink: boolean;
    incrementFileName: boolean;
    noOpen: boolean;
    newTab: "vertical" | "horizontal";
}