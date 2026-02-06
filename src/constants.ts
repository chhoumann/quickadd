export const VALUE_SYNTAX = "{{value}}";
export const DATE_SYNTAX = "{{date}}";
export const TIME_SYNTAX = "{{time}}";
export const NAME_SYNTAX = "{{name}}";
export const VARIABLE_SYNTAX = "{{value:<variable name>}}";
export const VARIABLE_DEFAULT_SYNTAX =
	"{{value:<variable name>|<default value>}}";
export const VARIABLE_DEFAULT_OPTION_SYNTAX =
	"{{value:<variable name>|default:<value>}}";
export const VARIABLE_LABEL_SYNTAX =
	"{{value:<variable name>|label:<helper text>}}";
export const VALUE_CASE_SYNTAX = "{{value|case:kebab}}";
export const VARIABLE_CASE_SYNTAX = "{{value:<variable name>|case:kebab}}";
export const FIELD_VAR_SYNTAX = "{{field:<field name>}}";
export const MATH_VALUE_SYNTAX = "{{mvalue}}";
export const LINKCURRENT_SYNTAX = "{{linkcurrent}}";
export const FILENAMECURRENT_SYNTAX = "{{filenamecurrent}}";
export const TITLE_SYNTAX = "{{title}}";
export const SELECTED_SYNTAX = "{{selected}}";
export const CLIPBOARD_SYNTAX = "{{clipboard}}";
export const RANDOM_SYNTAX = "{{random:<length>}}";
export const GLOBAL_VAR_SYNTAX = "{{global_var:<name>}}";

export const FORMAT_SYNTAX: string[] = [
	DATE_SYNTAX,
	"{{date:<dateformat>}}",
	"{{vdate:<variable name>, <date format>}}",
	"{{vdate:<variable name>, <date format>|<default value>}}",
	GLOBAL_VAR_SYNTAX,
	VALUE_SYNTAX,
	NAME_SYNTAX,
	VALUE_CASE_SYNTAX,
	VARIABLE_CASE_SYNTAX,
	VARIABLE_SYNTAX,
	VARIABLE_DEFAULT_SYNTAX,
	VARIABLE_DEFAULT_OPTION_SYNTAX,
	VARIABLE_LABEL_SYNTAX,
	FIELD_VAR_SYNTAX,
	"{{field:<fieldname>|folder:<path>}}",
	"{{field:<fieldname>|tag:<tagname>}}",
	"{{field:<fieldname>|inline:true}}",
	LINKCURRENT_SYNTAX,
	FILENAMECURRENT_SYNTAX,
	"{{macro:<macroname>}}",
	"{{macro:<macroname>|label:<label>}}",
	"{{template:<templatepath>}}",
	MATH_VALUE_SYNTAX,
	SELECTED_SYNTAX,
	CLIPBOARD_SYNTAX,
	RANDOM_SYNTAX,
];

export const FILE_NAME_FORMAT_SYNTAX: string[] = [
	DATE_SYNTAX,
	"{{date:<dateformat>}}",
	"{{vdate:<variable name>, <date format>}}",
	"{{vdate:<variable name>, <date format>|<default value>}}",
	GLOBAL_VAR_SYNTAX,
	VALUE_SYNTAX,
	NAME_SYNTAX,
	VALUE_CASE_SYNTAX,
	VARIABLE_CASE_SYNTAX,
	VARIABLE_SYNTAX,
	VARIABLE_DEFAULT_SYNTAX,
	VARIABLE_DEFAULT_OPTION_SYNTAX,
	VARIABLE_LABEL_SYNTAX,
	FIELD_VAR_SYNTAX,
	RANDOM_SYNTAX,
];

export const TEMPLATE_FORMAT_SYNTAX: string[] = [TITLE_SYNTAX];

export const NUMBER_REGEX = new RegExp(/^-?[0-9]*$/);

export const CREATE_IF_NOT_FOUND_TOP = "top";
export const CREATE_IF_NOT_FOUND_BOTTOM = "bottom";
export const CREATE_IF_NOT_FOUND_CURSOR = "cursor";

// == Format Syntax == //
export const DATE_REGEX = new RegExp(/{{DATE(\+-?[0-9]+)?}}/i);
export const DATE_REGEX_FORMATTED = new RegExp(
	/{{DATE:([^}\n\r+]*)(\+-?[0-9]+)?}}/i,
);
export const TIME_REGEX = new RegExp(/{{TIME}}/i);
export const TIME_REGEX_FORMATTED = new RegExp(/{{TIME:([^}\n\r+]*)}}/i);
export const NAME_VALUE_REGEX = new RegExp(
	/{{(?:NAME|VALUE)(?!:)(?:\|[^\n\r}]*)?}}/i,
);
export const VARIABLE_REGEX = new RegExp(/{{VALUE:([^\n\r}]*)}}/i);
export const FIELD_VAR_REGEX = new RegExp(/{{FIELD:([^\n\r}]*)}}/i);
export const FIELD_VAR_REGEX_WITH_FILTERS = new RegExp(
	/{{FIELD:([^\n\r}]*)(\|[^\n\r}]*)?}}/i,
);
export const DATE_VARIABLE_REGEX = new RegExp(
	/{{VDATE:([^\n\r},]*),\s*([^\n\r}|]*)(?:\|([^\n\r}]*))?}}/i,
);
export const LINK_TO_CURRENT_FILE_REGEX = new RegExp(/{{LINKCURRENT}}/i);
export const FILE_NAME_OF_CURRENT_FILE_REGEX = new RegExp(/{{FILENAMECURRENT}}/i);
export const MARKDOWN_FILE_EXTENSION_REGEX = new RegExp(/\.md$/);
export const CANVAS_FILE_EXTENSION_REGEX = new RegExp(/\.canvas$/);
export const JAVASCRIPT_FILE_EXTENSION_REGEX = new RegExp(/\.js$/);
export const MACRO_REGEX = new RegExp(/{{MACRO:([^\n\r}]*)}}/i);
export const TEMPLATE_REGEX = new RegExp(/{{TEMPLATE:([^\n\r}]*.md)}}/i);
export const GLOBAL_VAR_REGEX = new RegExp(/{{GLOBAL_VAR:([^\n\r}]*)}}/i);
export const INLINE_JAVASCRIPT_REGEX = new RegExp(
	/`{3,}js quickadd([\s\S]*?)`{3,}/,
);
export const MATH_VALUE_REGEX = new RegExp(/{{MVALUE}}/i);
export const TITLE_REGEX = new RegExp(/{{TITLE}}/i);

export const SELECTED_REGEX = new RegExp(/{{SELECTED}}/i);
export const CLIPBOARD_REGEX = new RegExp(/{{CLIPBOARD}}/i);
export const RANDOM_REGEX = new RegExp(/{{RANDOM:(\d+)}}/i);

// This is not an accurate wikilink regex - but works for its intended purpose.
export const FILE_LINK_REGEX = new RegExp(/\[\[([^\]]*)$/);
export const TAG_REGEX = new RegExp(/#([^ ]*)$/);

// == Format Syntax Suggestion == //
export const DATE_SYNTAX_SUGGEST_REGEX = new RegExp(
	/{{[D]?[A]?[T]?[E]?[}]?[}]?$/i,
);
export const DATE_FORMAT_SYNTAX_SUGGEST_REGEX = new RegExp(
	/{{[D]?[A]?[T]?[E]?[:]?$|{{DATE:[^\n\r}]*}}$/i,
);
export const NAME_SYNTAX_SUGGEST_REGEX = new RegExp(
	/{{[N]?[A]?[M]?[E]?[}]?[}]?$/i,
);
export const VALUE_SYNTAX_SUGGEST_REGEX = new RegExp(
	/{{[V]?[A]?[L]?[U]?[E]?[}]?[}]?$/i,
);
export const VARIABLE_SYNTAX_SUGGEST_REGEX = new RegExp(
	/{{[V]?[A]?[L]?[U]?[E]?[:]?$|{{VALUE:[^\n\r}]*}}$/i,
);
export const VARIABLE_DATE_SYNTAX_SUGGEST_REGEX = new RegExp(
	/{{[V]?[D]?[A]?[T]?[E]?[:]?$|{{VDATE:[^\n\r}]*}}$/i,
);
export const LINKCURRENT_SYNTAX_SUGGEST_REGEX = new RegExp(
	/{{[L]?[I]?[N]?[K]?[C]?[U]?[R]?[R]?[E]?[N]?[T]?[}]?[}]?$/i,
);
export const FILENAMECURRENT_SYNTAX_SUGGEST_REGEX = new RegExp(
	/{{[F]?[I]?[L]?[E]?[N]?[A]?[M]?[E]?[C]?[U]?[R]?[R]?[E]?[N]?[T]?[}]?[}]?$/i,
);
export const TEMPLATE_SYNTAX_SUGGEST_REGEX = new RegExp(
	/{{[T]?[E]?[M]?[P]?[L]?[A]?[T]?[E]?[:]?$|{{TEMPLATE:[^\n\r}]*[}]?[}]?$/i,
);
export const MACRO_SYNTAX_SUGGEST_REGEX = new RegExp(
	/{{[M]?[A]?[C]?[R]?[O]?[:]?$|{{MACRO:[^\n\r}]*}}$/i,
);
export const MATH_VALUE_SYNTAX_SUGGEST_REGEX = new RegExp(
	/{{[M]?[V]?[A]?[L]?[U]?[E]?[}]?[}]?/i,
);
export const TITLE_SYNTAX_SUGGEST_REGEX = new RegExp(
	/{{[T]?[I]?[T]?[L]?[E]?[}]?[}]?/i,
);
export const SELECTED_SYNTAX_SUGGEST_REGEX = new RegExp(
	/{{[S]?[E]?[L]?[E]?[C]?[T]?[E]?[D]?[}]?[}]?/i,
);
export const CLIPBOARD_SYNTAX_SUGGEST_REGEX = new RegExp(
	/{{[C]?[L]?[I]?[P]?[B]?[O]?[A]?[R]?[D]?[}]?[}]?$/i,
);
export const RANDOM_SYNTAX_SUGGEST_REGEX = new RegExp(
	/{{[R]?[A]?[N]?[D]?[O]?[M]?[:]?$|{{RANDOM:[^\n\r}]*}}$/i,
);
export const GLOBAL_VAR_SYNTAX_SUGGEST_REGEX = new RegExp(
	/{{[G]?[L]?[O]?[B]?[A]?[L]?[\_]?[V]?[A]?[R]?[:]?$|{{GLOBAL_VAR:[^\n\r}]*}}$/i,
);
export const TIME_SYNTAX_SUGGEST_REGEX = new RegExp(
	/{{[T]?[I]?[M]?[E]?[}]?[}]?/i,
);
export const TIME_FORMAT_SYNTAX_SUGGEST_REGEX = new RegExp(
	/{{[T]?[I]?[M]?[E]?[:]?$|{{TIME:[^\n\r}]*}}$/i,
);

// == Internal (reserved) variable keys == //
// Keys starting with "__qa." are reserved for QuickAdd internal preflight/runtime plumbing.
export const QA_INTERNAL_CAPTURE_TARGET_FILE_PATH =
	"__qa.captureTargetFilePath";

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
export const WIKI_LINK_REGEX = new RegExp(/\[\[([^\]]*)\]\]/);
