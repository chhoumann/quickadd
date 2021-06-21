import type IChoice from "./IChoice";

export default interface ICaptureChoice extends IChoice {
    captureTo: string;
    captureToActiveFile: boolean;
    createFileIfItDoesntExist: {enabled: boolean, createWithTemplate: boolean, template: string};
    format: { enabled: boolean, format: string };
    prepend: boolean;
    appendLink: boolean;
    task: boolean;
    insertAfter: { enabled: boolean, after: string };
}

