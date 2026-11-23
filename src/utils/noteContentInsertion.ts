import { getFrontMatterInfo } from "obsidian";

export interface NoteBodyInsertionResult {
	content: string;
	insertedStartOffset: number | null;
	insertedEndOffset: number | null;
}

/**
 * A leading BLANK line: everything up to the first line break, with no visible
 * content. Trailing spaces/tabs count (`"   \n"` reads as blank to Obsidian) and
 * CRLF is handled, but the line break itself is required — `"   text"` is content.
 */
const LEADING_BLANK_LINE = /^[^\S\r\n]*\r?\n/;

/** A leading line break, i.e. "this text already begins on a line of its own". */
const LEADING_LINE_BREAK = /^\r?\n/;

/** Markdown allows up to three spaces before `>`; more makes an indented code line. */
const BLOCKQUOTE_LINE = /^ {0,3}>/;

/**
 * A line break that leaves a blank line between `above` and `below` when the
 * last line of `above` and the first line of `below` are both blockquote lines,
 * otherwise "". Without it Markdown joins the two into one blockquote, and a
 * created callout opener no longer renders as a callout.
 */
export function blockquoteSeparator(above: string, below: string): string {
	const lastAbove = above.replace(/\n$/, "").split("\n").pop() ?? "";
	const firstBelow = below.split("\n", 1)[0];
	return BLOCKQUOTE_LINE.test(lastAbove) && BLOCKQUOTE_LINE.test(firstBelow) ? "\n" : "";
}

/**
 * Offset where the body begins: after the frontmatter, else 0. Uses Obsidian's
 * content-based `getFrontMatterInfo`, so it matches what Obsidian shows and a
 * stale metadata cache cannot misplace text. This structural boundary sits at the
 * start of the separator line; insertion uses getBodyInsertOffset.
 */
export function getBodyStartOffset(content: string): number {
	const info = getFrontMatterInfo(content);
	return info.exists ? info.contentStart : 0;
}

/**
 * Where a top-of-body insertion lands: the frontmatter boundary plus the one
 * blank separator line below the closing fence, so a capture never wedges
 * between fence and separator. Only when frontmatter exists, only one line, and
 * only when `text` does not open with a blank line of its own. Not exported:
 * getBodyStartOffset must stay the pure boundary that heading masking uses.
 */
function getBodyInsertOffset(content: string, text: string): number {
	const start = getBodyStartOffset(content);
	if (start === 0) return 0;
	if (LEADING_BLANK_LINE.test(text)) return start;

	// The separator is skipped over, never rewritten, so its bytes survive verbatim.
	const separator = LEADING_BLANK_LINE.exec(content.slice(start));
	return separator ? start + separator[0].length : start;
}

/**
 * Inserts `text` at the start of the note body. It adds whole lines and never
 * merges with or deletes an existing line: a leading newline when the preceding
 * block lacks one (a closing fence at EOF), and a trailing newline whenever body
 * content follows, since a `rest` starting with a newline is an empty first
 * line, not separation. The separator is a lone `\n`; Obsidian tolerates mixed
 * EOL in a CRLF note. `separateBlockquotes` adds a {@link blockquoteSeparator}
 * below the payload.
 */
export function insertAtNoteBodyStartWithResult(
	content: string,
	text: string,
	{ separateBlockquotes = false } = {},
): NoteBodyInsertionResult {
	if (text.length === 0) {
		return {
			content,
			insertedStartOffset: null,
			insertedEndOffset: null,
		};
	}

	const start = getBodyInsertOffset(content, text);
	const head = content.slice(0, start);
	const rest = content.slice(start);

	// Note the deliberately different predicate here: this asks "does the payload
	// already start on its own line", so a payload opening with `"   \n"` still needs
	// the separator (its visible `"   "` would otherwise glue onto the fence).
	const leadingSeparator =
		head.length > 0 && !head.endsWith("\n") && !LEADING_LINE_BREAK.test(text)
			? "\n"
			: "";
	const trailingSeparator =
		rest.length > 0 && !text.endsWith("\n") ? "\n" : "";
	const blankLine = separateBlockquotes ? blockquoteSeparator(text, rest) : "";

	const insertedStartOffset = head.length + leadingSeparator.length;
	const insertedEndOffset = insertedStartOffset + text.length;

	return {
		content: `${head}${leadingSeparator}${text}${trailingSeparator}${blankLine}${rest}`,
		insertedStartOffset,
		insertedEndOffset,
	};
}

export function insertAtNoteBodyStart(content: string, text: string): string {
	return insertAtNoteBodyStartWithResult(content, text).content;
}
