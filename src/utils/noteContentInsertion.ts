import { getFrontMatterInfo } from "obsidian";

/**
 * Offset at which the note body begins — immediately after the YAML frontmatter
 * block when present, otherwise 0.
 *
 * Uses Obsidian's own `getFrontMatterInfo`, so detection matches what Obsidian
 * shows the user exactly: empty frontmatter (`---\n---`) is recognised, a `---`
 * fence that is not at offset 0 is not, and `...`-style closes are rejected. This
 * is deliberately content-based (the metadata cache is not consulted) so a stale
 * or cold cache cannot place text in the wrong spot.
 */
export function getBodyStartOffset(content: string): number {
	const info = getFrontMatterInfo(content);
	return info.exists ? info.contentStart : 0;
}

/**
 * Insert `text` at the start of the note body — after frontmatter when present —
 * guaranteeing the inserted text occupies its own line(s):
 *
 *  - a leading newline when the preceding block (frontmatter, or nothing) does not
 *    already end with one. This protects frontmatter-only notes whose closing fence
 *    sits at EOF (`---\n---`), where the body offset lands on the fence itself.
 *  - a trailing newline when body content would otherwise follow on the same line.
 *
 * The trailing check is CRLF-aware so an existing blank line is absorbed rather
 * than doubled. The injected separator is a lone `\n` (matching the existing
 * capture/template insertion helpers); Obsidian tolerates the resulting mixed EOL.
 *
 * `TemplateInsertEngine.insertBodyIntoNoteContent` reuses this same primitive for its
 * "top" insert, but passes `body + "\n"` so an applied template block always ends on its
 * own line (leaving a blank-line separation when the body already ends in a newline).
 * Capture callers pass the payload as-is for tight single-snippet insertion.
 */
export function insertAtNoteBodyStart(content: string, text: string): string {
	// Inserting nothing leaves the note untouched (defensive: capture callers
	// already drop empty payloads upstream, but keep the helper safe in isolation).
	if (text.length === 0) return content;

	const start = getBodyStartOffset(content);
	const head = content.slice(0, start);
	const rest = content.slice(start);

	const leadingSeparator =
		head.length > 0 && !head.endsWith("\n") && !/^\r?\n/.test(text) ? "\n" : "";
	const trailingSeparator =
		rest.length > 0 && !text.endsWith("\n") && !/^\r?\n/.test(rest) ? "\n" : "";

	return `${head}${leadingSeparator}${text}${trailingSeparator}${rest}`;
}
