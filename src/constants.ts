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
export const VARIABLE_TEXT_SYNTAX =
	"{{value:<items>|text:<display items>}}";
export const VARIABLE_NAME_SYNTAX =
	"{{value:<options>|name:<variable name>}}";
export const VARIABLE_OPTIONAL_SYNTAX =
	"{{value:<variable name>|optional}}";
export const VDATE_OPTIONAL_SYNTAX =
	"{{vdate:<variable name>, <date format>|optional}}";
export const VALUE_CASE_SYNTAX = "{{value|case:kebab}}";
export const VARIABLE_CASE_SYNTAX = "{{value:<variable name>|case:kebab}}";
export const VALUE_TRIM_SYNTAX = "{{value|trim}}";
export const VARIABLE_TRIM_SYNTAX = "{{value:<variable name>|trim}}";
export const FIELD_VAR_SYNTAX = "{{field:<field name>}}";
export const FIELD_VAR_MULTI_SYNTAX = "{{field:<field name>|multi}}";
export const FILE_SYNTAX = "{{file:<folder>}}";
export const FILE_MULTI_SYNTAX = "{{file:<folder>|multi}}";
export const FILE_LINK_SYNTAX = "{{file:<folder>|link}}";
export const FILE_PATH_SYNTAX = "{{file:<folder>|path}}";
export const MATH_VALUE_SYNTAX = "{{mvalue}}";
export const LINKCURRENT_SYNTAX = "{{linkcurrent}}";
export const LINKSECTION_SYNTAX = "{{linksection}}";
export const FILENAMECURRENT_SYNTAX = "{{filenamecurrent}}";
export const FOLDERCURRENT_SYNTAX = "{{foldercurrent}}";
export const FOLDERCURRENT_NAME_SYNTAX = "{{foldercurrent|name}}";
export const FOLDER_SYNTAX = "{{folder}}";
export const TITLE_SYNTAX = "{{title}}";
export const SELECTED_SYNTAX = "{{selected}}";
export const CLIPBOARD_SYNTAX = "{{clipboard}}";
export const RANDOM_SYNTAX = "{{random:<length>}}";
export const GLOBAL_VAR_SYNTAX = "{{global_var:<name>}}";

export const FORMAT_SYNTAX: string[] = [
	DATE_SYNTAX,
	"{{date:<dateformat>}}",
	"{{date:<dateformat>|startof:<unit>}}",
	"{{date:<dateformat>|endof:<unit>}}",
	"{{vdate:<variable name>, <date format>}}",
	"{{vdate:<variable name>, <date format>|<default value>}}",
	VDATE_OPTIONAL_SYNTAX,
	GLOBAL_VAR_SYNTAX,
	VALUE_SYNTAX,
	NAME_SYNTAX,
	VALUE_CASE_SYNTAX,
	VARIABLE_CASE_SYNTAX,
	VALUE_TRIM_SYNTAX,
	VARIABLE_TRIM_SYNTAX,
	VARIABLE_SYNTAX,
	VARIABLE_DEFAULT_SYNTAX,
	VARIABLE_DEFAULT_OPTION_SYNTAX,
	VARIABLE_LABEL_SYNTAX,
	VARIABLE_TEXT_SYNTAX,
	VARIABLE_NAME_SYNTAX,
	VARIABLE_OPTIONAL_SYNTAX,
	FIELD_VAR_SYNTAX,
	FIELD_VAR_MULTI_SYNTAX,
	"{{field:<fieldname>|folder:<path>}}",
	"{{field:<fieldname>|tag:<tagname>}}",
	"{{field:<fieldname>|inline:true}}",
	"{{field:<fieldname>|inline:true|inline-code-blocks:ad-note}}",
	FILE_SYNTAX,
	FILE_MULTI_SYNTAX,
	FILE_LINK_SYNTAX,
	FILE_PATH_SYNTAX,
	LINKCURRENT_SYNTAX,
	LINKSECTION_SYNTAX,
	FILENAMECURRENT_SYNTAX,
	FOLDERCURRENT_SYNTAX,
	FOLDERCURRENT_NAME_SYNTAX,
	FOLDER_SYNTAX,
	"{{folder|name}}",
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
	"{{date:<dateformat>|startof:<unit>}}",
	"{{date:<dateformat>|endof:<unit>}}",
	"{{vdate:<variable name>, <date format>}}",
	"{{vdate:<variable name>, <date format>|<default value>}}",
	GLOBAL_VAR_SYNTAX,
	VALUE_SYNTAX,
	NAME_SYNTAX,
	VALUE_CASE_SYNTAX,
	VARIABLE_CASE_SYNTAX,
	VALUE_TRIM_SYNTAX,
	VARIABLE_TRIM_SYNTAX,
	VARIABLE_SYNTAX,
	VARIABLE_DEFAULT_SYNTAX,
	VARIABLE_DEFAULT_OPTION_SYNTAX,
	VARIABLE_LABEL_SYNTAX,
	VARIABLE_TEXT_SYNTAX,
	VARIABLE_NAME_SYNTAX,
	FIELD_VAR_SYNTAX,
	FILE_SYNTAX,
	FOLDERCURRENT_SYNTAX,
	FOLDERCURRENT_NAME_SYNTAX,
	RANDOM_SYNTAX,
];
// Note: |optional is deliberately absent from FILE_NAME_FORMAT_SYNTAX — an
// all-optional file name that resolves empty is rejected at creation time.

export const TEMPLATE_FORMAT_SYNTAX: string[] = [TITLE_SYNTAX];

export const NUMBER_REGEX = new RegExp(/^-?[0-9]*$/);

export const CREATE_IF_NOT_FOUND_TOP = "top";
export const CREATE_IF_NOT_FOUND_BOTTOM = "bottom";
export const CREATE_IF_NOT_FOUND_CURSOR = "cursor";
// "ordered": create a missing insert-after heading at its sorted position among
// same-level sibling headings (issue #481). Joins TOP/BOTTOM/CURSOR.
export const CREATE_IF_NOT_FOUND_ORDERED = "ordered";

// == Format Syntax == //
// The optional trailing `(?:\|(?:startof|endof):<letters>)?` group captures a
// date "snap" option (issue #511). It is anchored to `|startof:`/`|endof:`
// followed by letters, so a literal `|` anywhere else in a date format is still
// rendered verbatim ({{DATE:YYYY|MM}} -> 2023|06). The format slot's pipe arm
// `\|(?!(?:startof|endof):[a-z])` is mutually exclusive with `[^}\n\r+|]`, so
// the star is deterministic (no quadratic backtracking on malformed input) and a
// `|startof:` that is NOT a real snap (e.g. inside a `[...]` literal, or followed
// by a space/non-letter) stays part of the format instead of aborting the run.
export const DATE_REGEX = new RegExp(
	/{{DATE(\+-?[0-9]+)?(?:\|((?:startof|endof):[a-z]+))?}}/i,
);
export const DATE_REGEX_FORMATTED = new RegExp(
	/{{DATE:((?:[^}\n\r+|]|\|(?!(?:startof|endof):[a-z]))*)(\+-?[0-9]+)?(?:\|((?:startof|endof):[a-z]+))?}}/i,
);
export const TIME_REGEX = new RegExp(/{{TIME}}/i);
export const TIME_REGEX_FORMATTED = new RegExp(/{{TIME:([^}\n\r+]*)}}/i);
export const NAME_VALUE_REGEX = new RegExp(
	/{{(?:NAME|VALUE)(?!:)(?:\|[^\n\r}]*)?}}/i,
);
export const VARIABLE_REGEX = new RegExp(/{{VALUE:([^\n\r}]*)}}/i);
export const FIELD_VAR_REGEX = new RegExp(/{{FIELD:([^\n\r}]*)}}/i);
// Prefix used to namespace FIELD variable values in the variables map,
// keeping them separate from plain VALUE variables with the same name.
export const FIELD_VARIABLE_PREFIX = "FIELD:";
// Group 1 captures the field name, group 2 the optional `|filters` tail.
// Two ReDoS defenses are baked into the interior classes:
//   1. The name class excludes `|`, so the two quantified groups no longer
//      overlap. The original `([^\n\r}]*)(\|[^\n\r}]*)?` let both groups match
//      `|`, which is quadratic on `{{FIELD:` + a long unterminated run of `|`
//      (the outer star backtracks O(n) positions and the optional group re-scans
//      the tail at each).
//   2. Both classes also exclude `{`, so a match attempt cannot consume across a
//      following token opener. Without this, the unanchored exec loop in the
//      formatter (replaceFieldVarInString) is quadratic on a template that is a
//      long run of unterminated openers (`{{FIELD:` or `{{FIELD:|` repeated): the
//      interior greedily eats the rest of the string from every opener before
//      failing. This mirrors FILE_REGEX's `[^\n\r{}]*`; nested tokens inside a
//      field arg are unsupported, so excluding `{` only changes (already
//      malformed) `{`-bearing interiors.
// The anchored membership test in FieldValueProcessor is immune to the opener
// flood on its own (the `^` forces a single start position), but the shared
// formatter sink needs both defenses to stay linear. A field name never
// legitimately contains `|` or `{`, and a filter never contains `{`, so the
// matched language and the name+filters concatenation are unchanged for every
// well-formed token.
export const FIELD_VAR_REGEX_WITH_FILTERS = new RegExp(
	/{{FIELD:([^\n\r}|{]*)(\|[^\n\r}{]*)?}}/i,
);
// {{FILE:<folder>|...}} — pick a file from a folder. `{` is excluded from the
// interior so a malformed nested token (e.g. {{FILE:{{VALUE:x}}}}) cannot
// mis-consume; nested tokens inside the folder arg are unsupported. The required
// `:` means this never matches {{FILENAMECURRENT}} (no colon after FILE).
export const FILE_REGEX = new RegExp(/{{FILE:([^\n\r{}]*)}}/i);
// {{VDATE:<name>, <format>|<options>}} - group 1 is the variable name, group 2
// the optional date format (after the first comma), group 3 the optional
// |options tail. Two ReDoS defenses mirror FIELD_VAR_REGEX_WITH_FILTERS (#1455):
//   1. The comma arm is `,([^\n\r}|]*)`, not `,\s*([^\n\r}|]*)`. The old `\s*`
//      and the capture class both matched space/tab, so the two adjacent
//      quantifiers overlapped, going quadratic on `{{VDATE:a,` followed by a long
//      unterminated whitespace run (every split of the run is retried before the
//      missing `}}` fails). The capture class already accepts leading spaces and
//      every consumer trims group 2 (formatter.ts, RequirementCollector.ts, and
//      the two display formatters), so dropping `\s*` is output-identical for a
//      single-line token. A token literally spanning a newline after the comma no
//      longer matches, but group 1 and group 3 already excluded `\n\r`, so the
//      token was single-line everywhere except that artifact.
//   2. All three interior classes exclude `{`, so a match attempt cannot consume
//      across a following token opener. Without this the unanchored exec loop in
//      replaceDateVariableInString is quadratic on a long run of unterminated
//      `{{VDATE:` openers (each opener greedily eats the rest before failing).
//      A date format escapes literals with `[...]` and never contains `{`, and a
//      variable name never contains `{`, so this only changes already-malformed
//      `{`-bearing (nested-token) interiors, exactly like FIELD/FILE.
export const DATE_VARIABLE_REGEX = new RegExp(
	/{{VDATE:([^\n\r},|{]*)(?:,([^\n\r}|{]*))?(?:\|([^\n\r}{]*))?}}/i,
);
export const LINK_TO_CURRENT_FILE_REGEX = new RegExp(/{{LINKCURRENT}}/i);
// {{LINKSECTION}} resolves to a link to the current file at the heading the
// cursor is under, so the link scrolls there instead of the top (issue #387).
export const LINK_TO_CURRENT_SECTION_REGEX = new RegExp(/{{LINKSECTION}}/i);
export const FILE_NAME_OF_CURRENT_FILE_REGEX = new RegExp(/{{FILENAMECURRENT}}/i);
// {{FOLDERCURRENT}} resolves to the ACTIVE file's parent folder (vault-relative,
// no trailing slash; "" for a root-level file). The optional |name modifier
// yields just the leaf folder segment, mirroring {{FOLDER|name}}. Resolved in
// the combined single-pass resolver (formatter.replaceCurrentFileTokensInString),
// never via a standalone replace loop (#1358).
export const FOLDER_OF_CURRENT_FILE_REGEX = new RegExp(
	/{{FOLDERCURRENT(\|name)?}}/i,
);
// {{FOLDER}} resolves to the target folder the note is being created in.
// The optional |name modifier yields just the leaf folder segment.
export const TARGET_FOLDER_REGEX = new RegExp(/{{FOLDER(\|name)?}}/i);
export const MARKDOWN_FILE_EXTENSION_REGEX = new RegExp(/\.md$/i);
export const CANVAS_FILE_EXTENSION_REGEX = new RegExp(/\.canvas$/i);
export const BASE_FILE_EXTENSION_REGEX = new RegExp(/\.base$/i);
export const JAVASCRIPT_FILE_EXTENSION_REGEX = new RegExp(/\.js$/);
export const MACRO_REGEX = new RegExp(/{{MACRO:([^\n\r}]*)}}/i);
export const TEMPLATE_REGEX = new RegExp(
	/{{TEMPLATE:([^\n\r}]*\.(?:md|canvas|base))}}/i,
);
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
// {{linkcurrent}}, {{linksection}} share the "{{link" prefix, so the flat
// all-optional style would over-suggest (typing "{{linkc" would also match
// {{linksection}}). This strict left-to-right prefix matcher only accepts an
// actual prefix of "{{linksection}}", so "{{linkc" → linkcurrent only and
// "{{links" → linksection only.
export const LINKSECTION_SYNTAX_SUGGEST_REGEX = new RegExp(
	/^\{\{(?:l(?:i(?:n(?:k(?:s(?:e(?:c(?:t(?:i(?:o(?:n(?:\}\}?)?)?)?)?)?)?)?)?)?)?)?)?$/i,
);
export const FILENAMECURRENT_SYNTAX_SUGGEST_REGEX = new RegExp(
	/{{[F]?[I]?[L]?[E]?[N]?[A]?[M]?[E]?[C]?[U]?[R]?[R]?[E]?[N]?[T]?[}]?[}]?$/i,
);
// {{FOLDER}} is a strict prefix of {{FOLDERCURRENT}}, so the two flat matchers
// stay mutually consistent: at "{{folder" both are (correctly) offered, and the
// first extra letter disambiguates — "{{folderc" no longer matches
// FOLDER_SYNTAX_SUGGEST_REGEX (after R it only admits closing braces).
export const FOLDERCURRENT_SYNTAX_SUGGEST_REGEX = new RegExp(
	/{{[F]?[O]?[L]?[D]?[E]?[R]?[C]?[U]?[R]?[R]?[E]?[N]?[T]?[}]?[}]?$/i,
);
export const FOLDER_SYNTAX_SUGGEST_REGEX = new RegExp(
	/{{[F]?[O]?[L]?[D]?[E]?[R]?[}]?[}]?$/i,
);
// Requires the full literal "FILE" before offering {{FILE:}}, so it isn't
// offered prematurely at {{F/{{FI; {{FILENAMECURRENT}} still co-suggests at
// {{FILE (benign — both are valid completions of that prefix).
export const FILE_SYNTAX_SUGGEST_REGEX = new RegExp(
	/{{FILE[:]?$|{{FILE:[^\n\r}]*}}$/i,
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
	/{{[G]?[L]?[O]?[B]?[A]?[L]?[_]?[V]?[A]?[R]?[:]?$|{{GLOBAL_VAR:[^\n\r}]*}}$/i,
);
export const TIME_SYNTAX_SUGGEST_REGEX = new RegExp(
	/{{[T]?[I]?[M]?[E]?[}]?[}]?/i,
);
export const TIME_FORMAT_SYNTAX_SUGGEST_REGEX = new RegExp(
	/{{[T]?[I]?[M]?[E]?[:]?$|{{TIME:[^\n\r}]*}}$/i,
);

// == Internal (reserved) variable keys == //
// Keys starting with this prefix are reserved for QuickAdd internal
// preflight/runtime plumbing and must never be settable from across a trust
// boundary (obsidian:// URI, CLI, AI tool output). See isReservedVariableKey.
export const RESERVED_VARIABLE_PREFIX = "__qa.";
export const QA_INTERNAL_CAPTURE_TARGET_FILE_PATH = `${RESERVED_VARIABLE_PREFIX}captureTargetFilePath`;

// == MISC == //
export const WIKI_LINK_REGEX = new RegExp(/\[\[([^\]]*)\]\]/);
