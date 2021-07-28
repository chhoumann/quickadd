import type IChoice from "./IChoice";
import type {NewTabDirection} from "../newTabDirection";

export default interface ICaptureChoice extends IChoice {
    captureTo: string;
    captureToActiveFile: boolean;
    createFileIfItDoesntExist: {enabled: boolean, createWithTemplate: boolean, template: string};
    format: { enabled: boolean, format: string };
    /** Capture to bottom of file (after current file content). */
    prepend: boolean;
    appendLink: boolean;
    task: boolean;
    insertAfter: { enabled: boolean; after: string, insertAtEnd: boolean, createIfNotFound: boolean, createIfNotFoundLocation: string };
    openFile: boolean;
    openFileInNewTab: {enabled: boolean, direction: NewTabDirection};
}

