export const FORMAT_SYNTAX: string[] = [
    "{{DATE}}", "{{DATE:<DATEFORMAT>}}", "{{VDATE:<VARIABLE NAME>, <DATE FORMAT>}}",
    "{{VALUE}}", "{{NAME}}", "{{VALUE:<VARIABLE NAME>}}", "{{LINKCURRENT}}"
];

export const FILE_NAME_FORMAT_SYNTAX: string[] = [
    "{{DATE}}", "{{DATE:<DATEFORMAT>}}", "{{VDATE:<VARIABLE NAME>, <DATE FORMAT>}}",
    "{{VALUE}}", "{{NAME}}", "{{VALUE:<VARIABLE NAME>}}",
]

export const FILE_NUMBER_REGEX: RegExp = new RegExp(/([0-9]*)\.md$/);
export const DATE_REGEX: RegExp = new RegExp(/{{DATE}}|{{DATE:([^}\n\r]*)}}/);
export const NAME_VALUE_REGEX: RegExp = new RegExp(/{{NAME}}|{{VALUE}}/);
export const VARIABLE_REGEX: RegExp = new RegExp(/{{VALUE:([^\n\r}]*)}}/);
export const DATE_VARIABLE_REGEX: RegExp = new RegExp(/{{VDATE:([^\n\r},]*),\s*([^\n\r},]*)}}/);
export const LINK_TO_CURRENT_FILE_REGEX: RegExp = new RegExp(/{{LINKCURRENT}}/);
export const MARKDOWN_FILE_EXTENSION_REGEX: RegExp = new RegExp(/\.md$/);