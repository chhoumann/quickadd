import {Choice} from "./Choice";
import {ChoiceType} from "./choiceType";
import type ICaptureChoice from "./ICaptureChoice";

export class CaptureChoice extends Choice implements ICaptureChoice {
    appendLink: boolean;
    captureTo: string;
    format: { enabled: boolean; format: string };
    insertAfter: { enabled: boolean; after: string };
    prepend: boolean;
    task: boolean;

    constructor(name: string) {
        super(name, ChoiceType.Capture);
    }
}