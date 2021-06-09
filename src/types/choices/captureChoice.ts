import type {Choice} from "./choice";

export interface CaptureChoice extends Choice {
    captureTo: string;
    format: { enabled: boolean, format: string };
    prepend: boolean;
    appendLink: boolean;
    task: boolean;
    insertAfter: { enabled: boolean, after: string };
}