export const VALUE_SYNTAX: string = "{{VALUE}}";

export const FORMAT_SYNTAX: string[] = [
    "{{DATE}}", "{{DATE:<DATEFORMAT>}}", "{{VDATE:<VARIABLE NAME>, <DATE FORMAT>}}",
    VALUE_SYNTAX, "{{NAME}}", "{{VALUE:<VARIABLE NAME>}}", "{{LINKCURRENT}}", "{{MACRO:<MACRONAME>}}",
    "{{TEMPLATE:<TEMPLATEPATH>}}"
];

export const FILE_NAME_FORMAT_SYNTAX: string[] = [
    "{{DATE}}", "{{DATE:<DATEFORMAT>}}", "{{VDATE:<VARIABLE NAME>, <DATE FORMAT>}}",
    VALUE_SYNTAX, "{{NAME}}", "{{VALUE:<VARIABLE NAME>}}",
]

export const FILE_NUMBER_REGEX: RegExp = new RegExp(/([0-9]*)\.md$/);
export const DATE_REGEX: RegExp = new RegExp(/{{DATE(\+[0-9]*)?}}/);
export const DATE_REGEX_FORMATTED: RegExp = new RegExp(/{{DATE:([^}\n\r+]*)(\+[0-9]*)?}}/);
export const NAME_VALUE_REGEX: RegExp = new RegExp(/{{NAME}}|{{VALUE}}/);
export const VARIABLE_REGEX: RegExp = new RegExp(/{{VALUE:([^\n\r}]*)}}/);
export const DATE_VARIABLE_REGEX: RegExp = new RegExp(/{{VDATE:([^\n\r},]*),\s*([^\n\r},]*)}}/);
export const LINK_TO_CURRENT_FILE_REGEX: RegExp = new RegExp(/{{LINKCURRENT}}/);
export const MARKDOWN_FILE_EXTENSION_REGEX: RegExp = new RegExp(/\.md$/);
export const JAVASCRIPT_FILE_EXTENSION_REGEX: RegExp = new RegExp(/\.js$/);
export const MACRO_REGEX: RegExp = new RegExp(/{{MACRO:([^\n\r}]*)}}/);
export const TEMPLATE_REGEX: RegExp = new RegExp(/{{TEMPLATE:([^\n\r}]*.md)}}/);

