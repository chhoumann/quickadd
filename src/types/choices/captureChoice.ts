import type Choice from "./choice";

export default interface CaptureChoice extends Choice {
    captureTo: string;
    format: { enabled: boolean, format: string };
    prepend: boolean;
    appendLink: boolean;
    task: boolean;
    insertAfter: { enabled: boolean, after: string };
}