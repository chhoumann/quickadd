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

/**
 * Offset at which the note body begins — immediately after the YAML frontmatter
 * block when present, otherwise 0.
 *
 * Uses Obsidian's own `getFrontMatterInfo`, so detection matches what Obsidian
 * shows the user exactly: empty frontmatter (`---\n---`) is recognised, a `---`
 * fence that is not at offset 0 is not, and `...`-style closes are rejected. This
 * is deliberately content-based (the metadata cache is not consulted) so a stale
 * or cold cache cannot place text in the wrong spot.
 *
 * This is the STRUCTURAL boundary, and it lands on the start of the blank line that
 * usually separates frontmatter from the body. It is therefore the wrong offset to
 * write at — see `getBodyInsertOffset` below, which is what the insertion uses.
 */
export function getBodyStartOffset(content: string): number {
	const info = getFrontMatterInfo(content);
	return info.exists ? info.contentStart : 0;
}

/**
 * Offset a top-of-body insertion actually lands on: the frontmatter boundary from
 * {@link getBodyStartOffset}, plus the blank line that separates the frontmatter
 * block from the body when the note has one.
 *
 * `getFrontMatterInfo().contentStart` points at the byte right after the closing
 * fence's newline — i.e. at the START of that separator line, not after it. Writing
 * there wedges the capture between the fence and the blank line, so the note reads
 * as if its frontmatter and body were never separated (issue #1538). The separator
 * line is document furniture belonging to the frontmatter block, so the body starts
 * below it.
 *
 * Deliberately narrow:
 *  - only when frontmatter exists. A note with no frontmatter that happens to start
 *    with a blank line still gets "top of file" taken literally, at offset 0.
 *  - only ONE line. A longer blank run is body spacing the user chose, and only the
 *    first line of it is the frontmatter separator.
 *  - only when `text` does not already open with a blank line of its own. Such a
 *    payload supplies its own separation, and skipping as well would stack two blank
 *    lines (the "don't double" rule the leading separator below also applies). The
 *    payload is judged by the SAME blank-line definition as the note, so a template
 *    whose separator carries trailing spaces is recognised too.
 *
 * A closing fence sitting at EOF (`---\n---`) has nothing after it, so there is no
 * separator to find and the offset stays on the fence — where the leading separator
 * below takes over and keeps the fence intact.
 *
 * Not exported: {@link getBodyStartOffset} stays the pure frontmatter boundary that
 * `insertionPositioning.getBodyStartLine` uses for heading masking and ordered
 * section placement, and that boundary must not move.
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
 * Insert `text` at the start of the note body — below frontmatter and its separator
 * line when present — under one invariant: **the insertion adds whole lines. It never
 * merges with, and never deletes, an existing line.** Two separators enforce it:
 *
 *  - a leading newline when the preceding block (frontmatter, or nothing) does not
 *    already end with one. This protects frontmatter-only notes whose closing fence
 *    sits at EOF (`---\n---`), where the body offset lands on the fence itself.
 *  - a trailing newline whenever any body content follows, so the payload terminates
 *    its own line. This is unconditional on purpose: a `rest` that begins with a
 *    newline does NOT mean the payload is already separated — it means the first body
 *    line is EMPTY, and an unterminated payload would take that empty line's place,
 *    silently deleting a line from the note (issue #1538).
 *
 * The injected separator is a lone `\n` (matching the existing capture/template
 * insertion helpers, which splice on `\n` too); Obsidian tolerates the resulting
 * mixed EOL in a CRLF note.
 *
 * `TemplateInsertEngine.insertBodyIntoNoteContent` reuses this same primitive for its
 * "top" insert, but passes `body + "\n"` so an applied template block always ends on its
 * own line (leaving a blank-line separation when the body already ends in a newline).
 * Capture callers pass the payload as-is for tight single-snippet insertion.
 */
export function insertAtNoteBodyStartWithResult(
	content: string,
	text: string,
): NoteBodyInsertionResult {
	// Inserting nothing leaves the note untouched (defensive: capture callers
	// already drop empty payloads upstream, but keep the helper safe in isolation).
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

	const insertedStartOffset = head.length + leadingSeparator.length;
	const insertedEndOffset = insertedStartOffset + text.length;

	return {
		content: `${head}${leadingSeparator}${text}${trailingSeparator}${rest}`,
		insertedStartOffset,
		insertedEndOffset,
	};
}

export function insertAtNoteBodyStart(content: string, text: string): string {
	return insertAtNoteBodyStartWithResult(content, text).content;
}
