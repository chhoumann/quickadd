export const VALUE_SYNTAX: string = "{{value}}";
export const DATE_SYNTAX = "{{date}}";
export const NAME_SYNTAX = "{{name}}";
export const VARIABLE_SYNTAX = "{{value:<variable name>}}";
export const FIELD_VAR_SYNTAX = "{{field:<field name>}}";
export const MATH_VALUE_SYNTAX = "{{mvalue}}";
export const LINKCURRENT_SYNTAX = "{{linkcurrent}}";
export const TITLE_SYNTAX = "{{title}}";

export const FORMAT_SYNTAX: string[] = [
	DATE_SYNTAX,
	"{{date:<dateformat>}}",
	"{{vdate:<variable name>, <date format>}}",
	VALUE_SYNTAX,
	NAME_SYNTAX,
	VARIABLE_SYNTAX,
    FIELD_VAR_SYNTAX,
	LINKCURRENT_SYNTAX,
	"{{macro:<macroname>}}",
	"{{template:<templatepath>}}",
	MATH_VALUE_SYNTAX,
];

export const FILE_NAME_FORMAT_SYNTAX: string[] = [
	DATE_SYNTAX,
	"{{date:<dateformat>}}",
	"{{vdate:<variable name>, <date format>}}",
	VALUE_SYNTAX,
	NAME_SYNTAX,
	VARIABLE_SYNTAX,
    FIELD_VAR_SYNTAX,
];

export const TEMPLATE_FORMAT_SYNTAX: string[] = [TITLE_SYNTAX];

export const FILE_NUMBER_REGEX: RegExp = new RegExp(/([0-9]*)\.md$/);
export const NUMBER_REGEX: RegExp = new RegExp(/^-?[0-9]*$/);

export const CREATE_IF_NOT_FOUND_TOP: string = "top";
export const CREATE_IF_NOT_FOUND_BOTTOM: string = "bottom";

// == Format Syntax == //
export const DATE_REGEX: RegExp = new RegExp(/{{DATE(\+-?[0-9]+)?}}/i);
export const DATE_REGEX_FORMATTED: RegExp = new RegExp(
	/{{DATE:([^}\n\r+]*)(\+-?[0-9]+)?}}/i
);
export const NAME_VALUE_REGEX: RegExp = new RegExp(/{{NAME}}|{{VALUE}}/i);
export const VARIABLE_REGEX: RegExp = new RegExp(/{{VALUE:([^\n\r}]*)}}/i);
export const FIELD_VAR_REGEX: RegExp = new RegExp(/{{FIELD:([^\n\r}]*)}}/i);
export const DATE_VARIABLE_REGEX: RegExp = new RegExp(
	/{{VDATE:([^\n\r},]*),\s*([^\n\r},]*)}}/i
);
export const LINK_TO_CURRENT_FILE_REGEX: RegExp = new RegExp(
	/{{LINKCURRENT}}/i
);
export const MARKDOWN_FILE_EXTENSION_REGEX: RegExp = new RegExp(/\.md$/);
export const JAVASCRIPT_FILE_EXTENSION_REGEX: RegExp = new RegExp(/\.js$/);
export const MACRO_REGEX: RegExp = new RegExp(/{{MACRO:([^\n\r}]*)}}/i);
export const TEMPLATE_REGEX: RegExp = new RegExp(
	/{{TEMPLATE:([^\n\r}]*.md)}}/i
);
export const LINEBREAK_REGEX: RegExp = new RegExp(/\\n/);
export const INLINE_JAVASCRIPT_REGEX: RegExp = new RegExp(
	/`{3,}js quickadd([\s\S]*?)`{3,}/
);
export const MATH_VALUE_REGEX: RegExp = new RegExp(/{{MVALUE}}/i);
export const TITLE_REGEX: RegExp = new RegExp(/{{TITLE}}/i);

// This is not an accurate wikilink regex - but works for its intended purpose.
export const FILE_LINK_REGEX: RegExp = new RegExp(/\[\[([^\]]*)$/);
export const TAG_REGEX: RegExp = new RegExp(/#([^ ]*)$/);

// == Format Syntax Suggestion == //
export const DATE_SYNTAX_SUGGEST_REGEX: RegExp = new RegExp(
	/{{[D]?[A]?[T]?[E]?[}]?[}]?$/i
);
export const DATE_FORMAT_SYNTAX_SUGGEST_REGEX: RegExp = new RegExp(
	/{{[D]?[A]?[T]?[E]?[:]?$|{{DATE:[^\n\r}]*}}$/i
);
export const NAME_SYNTAX_SUGGEST_REGEX: RegExp = new RegExp(
	/{{[N]?[A]?[M]?[E]?[}]?[}]?$/i
);
export const VALUE_SYNTAX_SUGGEST_REGEX: RegExp = new RegExp(
	/{{[V]?[A]?[L]?[U]?[E]?[}]?[}]?$/i
);
export const VARIABLE_SYNTAX_SUGGEST_REGEX: RegExp = new RegExp(
	/{{[V]?[A]?[L]?[U]?[E]?[:]?$|{{VALUE:[^\n\r}]*}}$/i
);
export const VARIABLE_DATE_SYNTAX_SUGGEST_REGEX: RegExp = new RegExp(
	/{{[V]?[D]?[A]?[T]?[E]?[:]?$|{{VDATE:[^\n\r}]*}}$/i
);
export const LINKCURRENT_SYNTAX_SUGGEST_REGEX: RegExp = new RegExp(
	/{{[L]?[I]?[N]?[K]?[C]?[U]?[R]?[R]?[E]?[N]?[T]?[}]?[}]?$/i
);
export const TEMPLATE_SYNTAX_SUGGEST_REGEX: RegExp = new RegExp(
	/{{[T]?[E]?[M]?[P]?[L]?[A]?[T]?[E]?[:]?$|{{TEMPLATE:[^\n\r}]*[}]?[}]?$/i
);
export const MACRO_SYNTAX_SUGGEST_REGEX: RegExp = new RegExp(
	/{{[M]?[A]?[C]?[R]?[O]?[:]?$|{{MACRO:[^\n\r}]*}}$/i
);
export const MATH_VALUE_SYNTAX_SUGGEST_REGEX: RegExp = new RegExp(
	/{{[M]?[V]?[A]?[L]?[U]?[E]?[}]?[}]?/i
);
export const TITLE_SYNTAX_SUGGEST_REGEX: RegExp = new RegExp(
	/{{[T]?[I]?[T]?[L]?[E]?[}]?[}]?/i
);

// == File Exists (Template Choice) == //
export const fileExistsIncrement = "Increment the file name" as const;
export const fileExistsAppendToBottom =
	"Append to the bottom of the file" as const;
export const fileExistsAppendToTop = "Append to the top of the file" as const;
export const fileExistsOverwriteFile = "Overwrite the file" as const;
export const fileExistsDoNothing = "Nothing" as const;
export const fileExistsChoices = [
	fileExistsAppendToBottom,
	fileExistsAppendToTop,
	fileExistsOverwriteFile,
	fileExistsIncrement,
	fileExistsDoNothing,
] as const;

// == MISC == //
export const WIKI_LINK_REGEX: RegExp = new RegExp(/\[\[([^\]]*)\]\]/);
