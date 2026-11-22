export const VALUE_SYNTAX = "{{value}}";
export const NAME_SYNTAX = "{{name}}";

// The token language's authoring surface (descriptions, fields) lives in
// gui/suggesters/formatTokenRegistry.ts. VALUE_SYNTAX and NAME_SYNTAX above are
// runtime defaults, not display strings.

export const NUMBER_REGEX = /^-?[0-9]*$/;

export const CREATE_IF_NOT_FOUND_TOP = "top";
export const CREATE_IF_NOT_FOUND_BOTTOM = "bottom";
export const CREATE_IF_NOT_FOUND_CURSOR = "cursor";
// "ordered": create a missing insert-after heading at its sorted position among
// same-level sibling headings.
export const CREATE_IF_NOT_FOUND_ORDERED = "ordered";

// == Format Syntax == //
// DATE takes a start/end snap and a case transform, the case transform only as
// the terminal option (`|startof:week|case:lower`). Other literal pipes render
// verbatim ({{DATE:YYYY|MM}} -> 2023|06).
export const DATE_REGEX = /{{DATE(\+-?[0-9]+)?(?:\|((?:startof|endof):[a-z]+))?(?:\|case:([a-z-]+))?}}/i;
export const DATE_REGEX_FORMATTED = /{{DATE:((?:\[[^\]\n\r]*\]|\[(?![^\]\n\r]*\])|[^}\n\r+|[]|\|(?!(?:startof|endof):[a-z])(?!(?:case):[a-z-]+}}))*)(\+-?[0-9]+)?(?:\|((?:startof|endof):[a-z]+))?(?:\|case:([a-z-]+))?}}/i;
export const TIME_REGEX = /{{TIME(?:\|case:([a-z-]+))?}}/i;
export const TIME_REGEX_FORMATTED = /{{TIME:((?:\[[^\]\n\r]*\]|\[(?![^\]\n\r]*\])|[^}\n\r+|[]|\|(?!(?:case):[a-z-]+}}))*)(?:\|case:([a-z-]+))?}}/i;
export const NAME_VALUE_REGEX = /{{(?:NAME|VALUE)(?!:)(?:\|[^\n\r}]*)?}}/i;
export const VARIABLE_REGEX = /{{VALUE:([^\n\r}]*)}}/i;
// Prefix used to namespace FIELD variable values in the variables map,
// keeping them separate from plain VALUE variables with the same name.
export const FIELD_VARIABLE_PREFIX = "FIELD:";
// Group 1 is the field name, group 2 the optional `|filters` tail. ReDoS bounds:
// the name class excludes `|` so the two groups cannot overlap, and both classes
// exclude `{` so a match cannot run across a following opener in the unanchored
// exec loop of replaceFieldVarInString. Neither character is legal in a
// well-formed name, nor `{` in a filter.
export const FIELD_VAR_REGEX_WITH_FILTERS = /{{FIELD:([^\n\r}|{]*)(\|[^\n\r}{]*)?}}/i;
// {{FILE:<folder>|...}} — pick a file from a folder. `{` is excluded from the
// interior so a malformed nested token (e.g. {{FILE:{{VALUE:x}}}}) cannot
// mis-consume; nested tokens inside the folder arg are unsupported. The required
// `:` means this never matches {{FILENAMECURRENT}} (no colon after FILE).
export const FILE_REGEX = /{{FILE:([^\n\r{}]*)}}/i;
// {{VDATE:<name>, <format>|<options>}}: group 1 is the name, group 2 the optional
// format, group 3 the `|options` tail. ReDoS bounds as for FIELD: no `\s*` before
// the format (it overlapped the capture class; every consumer trims group 2), and
// no `{` in any interior class.
export const DATE_VARIABLE_REGEX = /{{VDATE:([^\n\r},|{]*)(?:,([^\n\r}|{]*))?(?:\|([^\n\r}{]*))?}}/i;
export const MARKDOWN_FILE_EXTENSION_REGEX = /\.md$/i;
export const CANVAS_FILE_EXTENSION_REGEX = /\.canvas$/i;
export const BASE_FILE_EXTENSION_REGEX = /\.base$/i;
export const JAVASCRIPT_FILE_EXTENSION_REGEX = /\.js$/i;
export const MACRO_REGEX = /{{MACRO:([^\n\r}]*)}}/i;
export const TEMPLATE_REGEX = /{{TEMPLATE:([^\n\r}]*\.(?:md|canvas|base))}}/i;
export const GLOBAL_VAR_REGEX = /{{GLOBAL_VAR:([^\n\r}]*)}}/i;
export const MATH_VALUE_REGEX = /{{MVALUE}}/i;
export const TITLE_REGEX = /{{TITLE}}/i;
// {{PROPERTY}} expands to the current value of the property this Capture is
// writing to (property Captures only). Flat token, no argument — distinct from
// {{FIELD:...}} (vault-wide suggestions) and from the property *name* field.
export const PROPERTY_REGEX = /{{PROPERTY}}/i;

export const SELECTED_REGEX = /{{SELECTED}}/i;
export const CLIPBOARD_REGEX = /{{CLIPBOARD}}/i;
export const RANDOM_REGEX = /{{RANDOM:(\d+)}}/i;

// This is not an accurate wikilink regex - but works for its intended purpose.
export const FILE_LINK_REGEX = /\[\[([^\]]*)$/;
export const TAG_REGEX = /#([^ ]*)$/;

// == Format Syntax Suggestion == //
export const DATE_SYNTAX_SUGGEST_REGEX = /{{[D]?[A]?[T]?[E]?[}]?[}]?$/i;
export const DATE_FORMAT_SYNTAX_SUGGEST_REGEX = /{{[D]?[A]?[T]?[E]?[:]?$|{{DATE:[^\n\r}]*}}$/i;
export const NAME_SYNTAX_SUGGEST_REGEX = /{{[N]?[A]?[M]?[E]?[}]?[}]?$/i;
export const VALUE_SYNTAX_SUGGEST_REGEX = /{{[V]?[A]?[L]?[U]?[E]?[}]?[}]?$/i;
export const VARIABLE_SYNTAX_SUGGEST_REGEX = /{{[V]?[A]?[L]?[U]?[E]?[:]?$|{{VALUE:[^\n\r}]*}}$/i;
export const VARIABLE_DATE_SYNTAX_SUGGEST_REGEX = /{{[V]?[D]?[A]?[T]?[E]?[:]?$|{{VDATE:[^\n\r}]*}}$/i;
export const LINKCURRENT_SYNTAX_SUGGEST_REGEX = /{{[L]?[I]?[N]?[K]?[C]?[U]?[R]?[R]?[E]?[N]?[T]?[}]?[}]?$/i;
// {{linkcurrent}}, {{linksection}} share the "{{link" prefix, so the flat
// all-optional style would over-suggest (typing "{{linkc" would also match
// {{linksection}}). This strict left-to-right prefix matcher only accepts an
// actual prefix of "{{linksection}}", so "{{linkc" → linkcurrent only and
// "{{links" → linksection only.
export const LINKSECTION_SYNTAX_SUGGEST_REGEX = /^\{\{(?:l(?:i(?:n(?:k(?:s(?:e(?:c(?:t(?:i(?:o(?:n(?:\}\}?)?)?)?)?)?)?)?)?)?)?)?)?$/i;
export const FILENAMECURRENT_SYNTAX_SUGGEST_REGEX = /{{[F]?[I]?[L]?[E]?[N]?[A]?[M]?[E]?[C]?[U]?[R]?[R]?[E]?[N]?[T]?[}]?[}]?$/i;
// {{FOLDER}} is a strict prefix of {{FOLDERCURRENT}}, so the two flat matchers
// stay mutually consistent: at "{{folder" both are (correctly) offered, and the
// first extra letter disambiguates — "{{folderc" no longer matches
// FOLDER_SYNTAX_SUGGEST_REGEX (after R it only admits closing braces).
export const FOLDERCURRENT_SYNTAX_SUGGEST_REGEX = /{{[F]?[O]?[L]?[D]?[E]?[R]?[C]?[U]?[R]?[R]?[E]?[N]?[T]?[}]?[}]?$/i;
export const FOLDER_SYNTAX_SUGGEST_REGEX = /{{[F]?[O]?[L]?[D]?[E]?[R]?[}]?[}]?$/i;
// Flat prefix matcher like its siblings, so {{FILE:}} shows up in the bare "{{"
// index. {{FIELD:}}, {{FILENAMECURRENT}} and the folder tokens co-suggest at the
// shared "{{f"/"{{fi" prefixes and disambiguate on the next letter.
export const FILE_SYNTAX_SUGGEST_REGEX = /{{[F]?[I]?[L]?[E]?[:]?$/i;
// Only the pre-colon prefix is reachable: the suggester stops once the segment
// contains ":".
export const FIELD_SYNTAX_SUGGEST_REGEX = /{{[F]?[I]?[E]?[L]?[D]?[:]?$/i;
export const TEMPLATE_SYNTAX_SUGGEST_REGEX = /{{[T]?[E]?[M]?[P]?[L]?[A]?[T]?[E]?[:]?$|{{TEMPLATE:[^\n\r}]*[}]?[}]?$/i;
export const MACRO_SYNTAX_SUGGEST_REGEX = /{{[M]?[A]?[C]?[R]?[O]?[:]?$|{{MACRO:[^\n\r}]*}}$/i;
export const MATH_VALUE_SYNTAX_SUGGEST_REGEX = /{{[M]?[V]?[A]?[L]?[U]?[E]?[}]?[}]?/i;
export const TITLE_SYNTAX_SUGGEST_REGEX = /{{[T]?[I]?[T]?[L]?[E]?[}]?[}]?/i;
export const PROPERTY_SYNTAX_SUGGEST_REGEX = /{{[P]?[R]?[O]?[P]?[E]?[R]?[T]?[Y]?[}]?[}]?$/i;
export const CURSOR_SYNTAX_SUGGEST_REGEX = /{{(?:C(?:U(?:R(?:S(?:O(?:R)?)?)?)?)?)?[}]?[}]?$/i;
export const SELECTED_SYNTAX_SUGGEST_REGEX = /{{[S]?[E]?[L]?[E]?[C]?[T]?[E]?[D]?[}]?[}]?/i;
export const CLIPBOARD_SYNTAX_SUGGEST_REGEX = /{{[C]?[L]?[I]?[P]?[B]?[O]?[A]?[R]?[D]?[}]?[}]?$/i;
export const DAILY_SYNTAX_SUGGEST_REGEX = /{{[D]?[A]?[I]?[L]?[Y]?[}]?[}]?$|{{DAILY\|[l]?[i]?[n]?[k]?[}]?[}]?$/i;
export const WEEKLY_SYNTAX_SUGGEST_REGEX = /{{[W]?[E]?[E]?[K]?[L]?[Y]?[}]?[}]?$|{{WEEKLY\|[l]?[i]?[n]?[k]?[}]?[}]?$/i;
export const MONTHLY_SYNTAX_SUGGEST_REGEX = /{{[M]?[O]?[N]?[T]?[H]?[L]?[Y]?[}]?[}]?$|{{MONTHLY\|[l]?[i]?[n]?[k]?[}]?[}]?$/i;
export const QUARTERLY_SYNTAX_SUGGEST_REGEX = /{{[Q]?[U]?[A]?[R]?[T]?[E]?[R]?[L]?[Y]?[}]?[}]?$|{{QUARTERLY\|[l]?[i]?[n]?[k]?[}]?[}]?$/i;
export const YEARLY_SYNTAX_SUGGEST_REGEX = /{{[Y]?[E]?[A]?[R]?[L]?[Y]?[}]?[}]?$|{{YEARLY\|[l]?[i]?[n]?[k]?[}]?[}]?$/i;
export const RANDOM_SYNTAX_SUGGEST_REGEX = /{{[R]?[A]?[N]?[D]?[O]?[M]?[:]?$|{{RANDOM:[^\n\r}]*}}$/i;
export const GLOBAL_VAR_SYNTAX_SUGGEST_REGEX = /{{[G]?[L]?[O]?[B]?[A]?[L]?[_]?[V]?[A]?[R]?[:]?$|{{GLOBAL_VAR:[^\n\r}]*}}$/i;
export const TIME_SYNTAX_SUGGEST_REGEX = /{{[T]?[I]?[M]?[E]?[}]?[}]?/i;
export const TIME_FORMAT_SYNTAX_SUGGEST_REGEX = /{{[T]?[I]?[M]?[E]?[:]?$|{{TIME:[^\n\r}]*}}$/i;

// == Internal (reserved) variable keys == //
// Keys starting with this prefix are reserved for QuickAdd internal
// preflight/runtime plumbing and must never be settable from across a trust
// boundary (obsidian:// URI, CLI, AI tool output). See isReservedVariableKey.
export const RESERVED_VARIABLE_PREFIX = "__qa.";
export const QA_INTERNAL_CAPTURE_TARGET_FILE_PATH = `${RESERVED_VARIABLE_PREFIX}captureTargetFilePath`;
export const QA_INTERNAL_DATE_ORIGIN = `${RESERVED_VARIABLE_PREFIX}dateOrigin`;

// == MISC == //
/**
 * How deep `{{TEMPLATE:}}` includes nest. The formatter stops there, and the
 * package walks over bundled notes stop at the same depth so a note that
 * includes itself cannot spin them forever.
 */
export const MAX_TEMPLATE_INCLUSION_DEPTH = 10;
export const WIKI_LINK_REGEX = /\[\[([^\]]*)\]\]/;
export const ASK_ME_MODEL = "Ask me";
