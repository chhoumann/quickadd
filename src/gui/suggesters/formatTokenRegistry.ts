import {
	CLIPBOARD_SYNTAX_SUGGEST_REGEX,
	DATE_FORMAT_SYNTAX_SUGGEST_REGEX,
	DATE_SYNTAX_SUGGEST_REGEX,
	FIELD_SYNTAX_SUGGEST_REGEX,
	FILENAMECURRENT_SYNTAX_SUGGEST_REGEX,
	FILE_SYNTAX_SUGGEST_REGEX,
	FOLDERCURRENT_SYNTAX_SUGGEST_REGEX,
	FOLDER_SYNTAX_SUGGEST_REGEX,
	GLOBAL_VAR_SYNTAX_SUGGEST_REGEX,
	LINKCURRENT_SYNTAX_SUGGEST_REGEX,
	LINKSECTION_SYNTAX_SUGGEST_REGEX,
	MACRO_SYNTAX_SUGGEST_REGEX,
	MATH_VALUE_SYNTAX_SUGGEST_REGEX,
	NAME_SYNTAX_SUGGEST_REGEX,
	RANDOM_SYNTAX_SUGGEST_REGEX,
	SELECTED_SYNTAX_SUGGEST_REGEX,
	TEMPLATE_SYNTAX_SUGGEST_REGEX,
	TIME_FORMAT_SYNTAX_SUGGEST_REGEX,
	TIME_SYNTAX_SUGGEST_REGEX,
	TITLE_SYNTAX_SUGGEST_REGEX,
	VALUE_SYNTAX_SUGGEST_REGEX,
	VARIABLE_DATE_SYNTAX_SUGGEST_REGEX,
	VARIABLE_SYNTAX_SUGGEST_REGEX,
} from "../../constants";

/**
 * Which format field the suggester is attached to. Every field runs a different
 * CompleteFormatter entry point, and those entry points genuinely disagree
 * about which tokens resolve: {{TITLE}} *throws* in a file path, {{LINKCURRENT}}
 * is left literal there, and {{FOLDER}} collapses to "" in a capture target.
 * Offering a token the field cannot resolve is a bug, so the field context is
 * modelled explicitly rather than as a boolean plus an exclusion list.
 */
export type FormatSuggestContext =
	/** Note bodies: capture format, template content, AI prompts, script inputs. `formatFileContent`. */
	| "noteContent"
	/** Capture "Capture to". `formatFileName`, but the note is not created *into* a target folder. */
	| "captureTarget"
	/** Template "File name format". `formatFileName` with a configured target folder. */
	| "fileName"
	/** Insert after / insert before line targets. `formatLocationString`. */
	| "lineTarget";

export const ALL_FORMAT_SUGGEST_CONTEXTS: readonly FormatSuggestContext[] = [
	"noteContent",
	"captureTarget",
	"fileName",
	"lineTarget",
];

/** Every context whose value is fed to a formatter that produces a path. */
const PATH_CONTEXTS: readonly FormatSuggestContext[] = ["captureTarget", "fileName"];
const ALL: readonly FormatSuggestContext[] = ALL_FORMAT_SUGGEST_CONTEXTS;

/**
 * One row in the autocomplete. `insert` is what lands in the field; everything
 * else exists so the row can teach what it does before it is accepted.
 */
export interface FormatTokenSuggestion {
	/** Exact text written into the field when this row is accepted. */
	insert: string;
	/** One-line, plain-English explanation rendered beside the token (#1542). */
	description: string;
	/**
	 * Where the caret lands after insertion, counted back from the end of
	 * `insert`. 2 parks it between the closing braces of an empty argument
	 * ("{{DATE:|}}"); 0 leaves it after the token. Explicit per row because
	 * inferring it from the text used to mis-place the caret inside the token
	 * word for the argument-less "{{TEMPLATE:" / "{{MACRO:" forms.
	 */
	caretOffset: number;
	/** Bare fragments (the `|case:` styles) render without token styling. */
	isFragment?: boolean;
}

export interface FormatTokenEntry {
	/** Prefix matcher deciding whether this row is still a candidate. */
	regex: RegExp;
	/** The row shown for the token itself. */
	suggestion: FormatTokenSuggestion;
	/** Fields this token actually resolves in. */
	contexts: readonly FormatSuggestContext[];
	/**
	 * Worked examples for this token family. Withheld until the user has typed
	 * enough of the token's name to have asked for it (see
	 * {@link EXPANSION_MIN_PREFIX}), so a bare "{{" stays a readable index.
	 */
	expansions?: (data: FormatTokenExpansionData) => FormatTokenSuggestion[];
}

/** Vault/settings data the dynamic rows are built from. */
export interface FormatTokenExpansionData {
	templatePaths: readonly string[];
	macroNames: readonly string[];
	globalVariableNames: readonly string[];
	context: FormatSuggestContext;
	/**
	 * Renders a Moment format against the current moment, so a date example can
	 * show what it actually produces instead of a sample that goes stale in the
	 * source file.
	 */
	formatDate: (momentFormat: string) => string;
}

/**
 * How many characters after "{{" the user must type before a token's worked
 * examples join the list. At "{{" the popup is an index of what exists; from
 * "{{val" on it is help with one token, so the examples earn their room.
 */
export const EXPANSION_MIN_PREFIX = 3;

function token(
	insert: string,
	description: string,
	caretOffset = insert.endsWith(":}}") ? 2 : 0,
): FormatTokenSuggestion {
	return { insert, description, caretOffset };
}

/**
 * The canonical list, in the order it is offered. Ordering follows the docs'
 * quick reference (ask for input, dates, the note you ran from, the note being
 * created, other content) so the first row a new user meets, {{VALUE}}, is
 * the one that explains what format syntax is for.
 *
 * Casing matches the documentation (uppercase token, lowercase modifiers).
 * Every runtime regex carries /i, so this is a display convention, not a
 * behaviour change; previously the list mixed "{{date}}" with "{{DATE:}}" and
 * left users guessing whether the difference meant anything (#1542).
 */
export const FORMAT_TOKEN_ENTRIES: readonly FormatTokenEntry[] = [
	// == Ask for input ==
	{
		regex: VALUE_SYNTAX_SUGGEST_REGEX,
		contexts: ALL,
		suggestion: token("{{VALUE}}", "Asks you for text when the choice runs"),
	},
	{
		regex: VARIABLE_SYNTAX_SUGGEST_REGEX,
		contexts: ALL,
		suggestion: token(
			"{{VALUE:}}",
			"Asks once and reuses the answer by name, or lists options to pick from",
		),
		expansions: () => [
			token("{{VALUE:title}}", 'Asks once, then reuses the answer as "title"'),
			token("{{VALUE:option1,option2,option3}}", "Asks you to pick one of these options"),
			token(
				"{{VALUE:option1,option2,option3|custom}}",
				"Same, but you can also type your own",
			),
			token("{{VALUE:title|label:Note title}}", "Words the prompt yourself"),
			token("{{VALUE:option1,option2|label:Pick one}}", "A list with your own prompt text"),
			token(
				"{{VALUE:title|label:Note title|default:Untitled}}",
				"Opens the prompt with an answer already filled in",
			),
			token(
				"{{VALUE:<items>|text:<display items>}}",
				"Shows one label in the list and inserts another",
			),
			token(
				"{{VALUE:option1,option2|name:category}}",
				'Names the pick, so {{VALUE:category}} reuses it',
			),
			// A ready-made, valid |case: token. Without it the only way to reach
			// |case: is to hand-type it inside an already-closed token, and the
			// live preview warns on every keystroke of a half-typed style name.
			token(
				"{{VALUE:title|case:kebab}}",
				"Reshapes the answer; type |case: for every style",
			),
			token("{{VALUE:title|trim}}", "Trims whitespace off the answer"),
			token("{{VALUE:title|optional}}", "Lets the prompt be skipped, leaving it empty"),
		],
	},
	{
		regex: NAME_SYNTAX_SUGGEST_REGEX,
		contexts: ALL,
		suggestion: token("{{NAME}}", "Another name for {{VALUE}}; they do the same thing"),
	},
	{
		regex: VARIABLE_DATE_SYNTAX_SUGGEST_REGEX,
		contexts: ALL,
		suggestion: token("{{VDATE:}}", 'Asks you for a date; "tomorrow" works'),
		expansions: () => [
			token("{{VDATE:date,YYYY-MM-DD}}", 'Asks for a date, reused by name as "date"'),
			token("{{VDATE:date,YYYY-MM-DD|today}}", "Same, with today filled in"),
			token("{{VDATE:dueDate,YYYY-MM-DD|next monday}}", "Same, starting at next Monday"),
			token("{{VDATE:dueDate,YYYY-MM-DD|optional}}", "Same, but skippable"),
			token(
				"{{VDATE:date,dddd, MMMM Do, YYYY|case:lower}}",
				"Lowercases the picked date after formatting",
			),
		],
	},
	{
		regex: FIELD_SYNTAX_SUGGEST_REGEX,
		contexts: ALL,
		suggestion: token(
			"{{FIELD:}}",
			"Suggests values a property already has in your vault, like {{FIELD:project}}",
		),
	},
	{
		regex: FILE_SYNTAX_SUGGEST_REGEX,
		contexts: ALL,
		suggestion: token("{{FILE:}}", "Picks a note from a folder"),
		expansions: ({ context }) => {
			const rows = [
				token("{{FILE:<folder>}}", "Picks a note from that folder and inserts its name"),
			];
			// |link and |path insert characters that are invalid in a file name,
			// and |optional permits an all-optional name resolving to nothing,
			// which is rejected at creation time.
			if (!PATH_CONTEXTS.includes(context)) {
				rows.push(
					token("{{FILE:<folder>|link}}", "Same, but inserts a link to the note"),
					token("{{FILE:<folder>|path}}", "Same, but inserts its full path"),
					token("{{FILE:<folder>|optional}}", "Same, but skippable"),
				);
			}
			rows.push(
				token("{{FILE:<folder>|custom}}", "Same, but you can also type a name that is not there yet"),
			);
			return rows;
		},
	},
	{
		regex: MATH_VALUE_SYNTAX_SUGGEST_REGEX,
		contexts: ALL,
		suggestion: token("{{MVALUE}}", "Asks you for a math formula (LaTeX), with a live preview"),
	},

	// == Dates ==
	{
		regex: DATE_SYNTAX_SUGGEST_REGEX,
		contexts: ALL,
		suggestion: token("{{DATE}}", "Today's date, as YYYY-MM-DD"),
	},
	{
		regex: DATE_FORMAT_SYNTAX_SUGGEST_REGEX,
		contexts: ALL,
		suggestion: token(
			"{{DATE:}}",
			"Today's date in a format you choose, like {{DATE:MMMM Do}}",
		),
		// Moment format strings are the one part of the syntax nobody guesses,
		// so these show what they render to right now rather than a sample that
		// would go stale in the source.
		expansions: ({ formatDate }) => [
			...["YYYY-MM-DD", "MMMM Do, YYYY", "ddd D MMM", "gggg-[W]ww"].map((fmt) =>
				token(`{{DATE:${fmt}}}`, formatDate(fmt)),
			),
			token("{{DATE+7}}", "Seven days from today"),
			token(
				"{{DATE:YYYY-MM-DD|startof:week}}",
				"Snapped to the start of the week, month, quarter or year",
			),
			token(
				"{{DATE:dddd, MMMM Do, YYYY|case:lower}}",
				"Lowercases the formatted date",
			),
		],
	},
	{
		regex: TIME_SYNTAX_SUGGEST_REGEX,
		contexts: ALL,
		suggestion: token("{{TIME}}", "The current time, as HH:mm"),
	},
	{
		regex: TIME_FORMAT_SYNTAX_SUGGEST_REGEX,
		contexts: ALL,
		suggestion: token(
			"{{TIME:}}",
			"The current time in a format you choose, like {{TIME:HH.mm}}",
		),
		expansions: () => [
			token("{{TIME:A|case:lower}}", "Lowercases formatted text, such as AM to am"),
		],
	},

	// == The note you ran QuickAdd from ==
	{
		regex: LINKCURRENT_SYNTAX_SUGGEST_REGEX,
		// Left literal by formatFileName, so a capture target would be named
		// "[[...]]", so it is offered only where a link is content.
		contexts: ["noteContent", "lineTarget"],
		suggestion: token("{{LINKCURRENT}}", "A link to that note: [[That note]]"),
	},
	{
		regex: LINKSECTION_SYNTAX_SUGGEST_REGEX,
		contexts: ["noteContent", "lineTarget"],
		suggestion: token("{{LINKSECTION}}", "A link to the section your cursor is in"),
	},
	{
		regex: FILENAMECURRENT_SYNTAX_SUGGEST_REGEX,
		contexts: ["noteContent", "captureTarget", "fileName", "lineTarget"],
		suggestion: token("{{FILENAMECURRENT}}", "That note's file name"),
	},
	{
		// formatLocationString deliberately leaves this literal, and an empty
		// selector would match the first line, so it is withheld there.
		regex: FOLDERCURRENT_SYNTAX_SUGGEST_REGEX,
		contexts: ["noteContent", "captureTarget"],
		suggestion: token("{{FOLDERCURRENT}}", "That note's folder"),
	},
	{
		// In a template file name the full path would nest under the configured
		// target folder ("Notes/Projects/Alpha/Note.md"), so only the leaf form
		// is offered there.
		regex: FOLDERCURRENT_SYNTAX_SUGGEST_REGEX,
		contexts: ["fileName"],
		suggestion: token("{{FOLDERCURRENT|name}}", "That note's folder name, without the path"),
	},
	{
		regex: SELECTED_SYNTAX_SUGGEST_REGEX,
		contexts: ALL,
		suggestion: token("{{SELECTED}}", "The text you had selected in the editor"),
	},

	// == The note being created ==
	{
		// Throws in every path context: the title is derived from the path.
		regex: TITLE_SYNTAX_SUGGEST_REGEX,
		contexts: ["noteContent", "lineTarget"],
		suggestion: token("{{TITLE}}", "The new note's file name"),
	},
	{
		// The bare {{FOLDER}} expands to the full target path, so "{{FOLDER}} -
		// Note" under Projects/Acme would yield "Projects/Acme/Projects/Acme -
		// Note.md". The leaf form avoids that duplicated segment.
		regex: FOLDER_SYNTAX_SUGGEST_REGEX,
		contexts: ["fileName"],
		suggestion: token("{{FOLDER|name}}", "The name of the folder the new note lands in"),
	},

	// == Other content ==
	{
		regex: CLIPBOARD_SYNTAX_SUGGEST_REGEX,
		contexts: ALL,
		suggestion: token("{{CLIPBOARD}}", "Whatever you copied last"),
	},
	{
		regex: TEMPLATE_SYNTAX_SUGGEST_REGEX,
		contexts: ALL,
		suggestion: token("{{TEMPLATE:}}", "The contents of a template file"),
		expansions: ({ templatePaths }) =>
			templatePaths.map((path) =>
				token(`{{TEMPLATE:${path}}}`, "Inserts this template's contents"),
			),
	},
	{
		regex: MACRO_SYNTAX_SUGGEST_REGEX,
		contexts: ALL,
		suggestion: token("{{MACRO:}}", "Whatever a macro returns"),
		expansions: ({ macroNames }) => [
			...macroNames.map((name) => token(`{{MACRO:${name}}}`, `Runs your "${name}" macro`)),
			token("{{MACRO:MyMacro|label:Label}}", "Word the macro's own prompt yourself"),
		],
	},
	{
		regex: GLOBAL_VAR_SYNTAX_SUGGEST_REGEX,
		contexts: ALL,
		suggestion: token("{{GLOBAL_VAR:}}", "A snippet you defined in QuickAdd's settings"),
		expansions: ({ globalVariableNames }) =>
			globalVariableNames.map((name) =>
				token(`{{GLOBAL_VAR:${name}}}`, `Inserts your "${name}" snippet`),
			),
	},
	{
		regex: RANDOM_SYNTAX_SUGGEST_REGEX,
		contexts: ALL,
		suggestion: token(
			"{{RANDOM:}}",
			"A random ID of the length you give, like {{RANDOM:6}}",
		),
	},
];

/**
 * Casing styles completed after `|case:` inside a supported token. These are
 * bare fragments, not tokens, so each one shows what it does to a title rather
 * than pretending to be insertable syntax on its own.
 */
export const CASE_STYLE_SUGGESTIONS: readonly FormatTokenSuggestion[] = [
	{ insert: "kebab", description: "my-note-title", caretOffset: 0, isFragment: true },
	{ insert: "snake", description: "my_note_title", caretOffset: 0, isFragment: true },
	{ insert: "camel", description: "myNoteTitle", caretOffset: 0, isFragment: true },
	{ insert: "pascal", description: "MyNoteTitle", caretOffset: 0, isFragment: true },
	{ insert: "title", description: "My Note Title", caretOffset: 0, isFragment: true },
	{ insert: "lower", description: "my note title", caretOffset: 0, isFragment: true },
	{ insert: "upper", description: "MY NOTE TITLE", caretOffset: 0, isFragment: true },
	{ insert: "slug", description: "my-note-title, guarded against reserved file names", caretOffset: 0, isFragment: true },
];

/** Entries offered in a given field, in display order. */
export function entriesForContext(
	context: FormatSuggestContext,
): readonly FormatTokenEntry[] {
	return FORMAT_TOKEN_ENTRIES.filter((entry) => entry.contexts.includes(context));
}
