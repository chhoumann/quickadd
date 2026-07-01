/**
 * Single-source heading sanitizer. Removes image embeds, wikilinks, markdown
 * formatting, and ATX heading markers from heading text for display/search.
 *
 * Implemented as linear single-pass scanners instead of the historical chained
 * regexes. Three of those regexes backtracked quadratically on adversarial
 * headings (a markdown heading is any single `#`-prefixed line, of unbounded
 * length, and FileIndex runs this over every heading of every note):
 *
 *   - /\[\[([^\]|]*?)(\|([^\]]*?))?\]\]/g  on "[".repeat(n)        (wikilinks)
 *   - /!\[\[[^\]]*\]\]/g                   on "![[".repeat(n)      (images)
 *   - /^#+\s*|\s*#+$/g                     on interior "#"/space runs (hashes)
 *
 * Each scanner below is byte-for-byte equivalent to the regex pass it replaced
 * (differentially fuzzed against the old pipeline); the pass ORDER is part of
 * the contract: images → wikilinks → md chars → hashes → stray brackets → trim.
 *
 * This module is dependency-free on purpose so it can be exercised standalone
 * (fuzz harnesses, node scripts) without pulling in Obsidian imports.
 */

const BANG = 0x21; /* ! */
const HASH = 0x23; /* # */
const OPEN = 0x5b; /* [ */
const CLOSE = 0x5d; /* ] */
const PIPE = 0x7c; /* | */

const SINGLE_WHITESPACE_RE = /^\s$/;

function isWhitespaceCodeUnit(text: string, index: number): boolean {
	return SINGLE_WHITESPACE_RE.test(text[index]);
}

/**
 * Pass 1 - remove image embeds. Equivalent to
 * `replace(/!\[\[[^\]]*\]\]/g, "")`: at each `![[`, the greedy `[^\]]*` runs to
 * the FIRST `]`, which must start a `]]` pair for the whole embed to match.
 * `close` only ever moves forward, so failed openers sharing one long
 * bracket-free tail cost O(n) total instead of O(n) each.
 */
function stripImageEmbeds(text: string): string {
	let out = "";
	let i = 0;
	let close = 0;
	while (i < text.length) {
		if (
			text.charCodeAt(i) === BANG &&
			text.charCodeAt(i + 1) === OPEN &&
			text.charCodeAt(i + 2) === OPEN
		) {
			if (close < i + 3) close = i + 3;
			while (close < text.length && text.charCodeAt(close) !== CLOSE) {
				close++;
			}
			if (close < text.length && text.charCodeAt(close + 1) === CLOSE) {
				i = close + 2; // drop the whole ![[...]] embed
				continue;
			}
		}
		out += text[i];
		i++;
	}
	return out;
}

/**
 * Pass 2 - resolve wikilinks to their alias (or target). Equivalent to
 * `replace(/\[\[([^\]|]*?)(\|([^\]]*?))?\]\]/g, (_, p1, _p2, alias) => alias ?? p1)`:
 * after `[[`, the target runs to the first `]` or `|`; a `]` must start `]]`
 * (emit the target), a `|` starts an alias that runs to the first `]`, which
 * must start `]]` (emit the alias). Anything else leaves the opener literal.
 * Both search cursors are monotonic, keeping the scan linear on opener floods.
 */
function resolveWikiLinks(text: string): string {
	let out = "";
	let i = 0;
	let stop = 0; // first `]` or `|` at/after the link target
	let close = 0; // first `]` at/after the alias
	while (i < text.length) {
		if (
			text.charCodeAt(i) === OPEN &&
			text.charCodeAt(i + 1) === OPEN
		) {
			if (stop < i + 2) stop = i + 2;
			while (stop < text.length) {
				const code = text.charCodeAt(stop);
				if (code === CLOSE || code === PIPE) break;
				stop++;
			}
			if (stop < text.length && text.charCodeAt(stop) === CLOSE) {
				if (text.charCodeAt(stop + 1) === CLOSE) {
					out += text.slice(i + 2, stop); // [[target]] → target
					i = stop + 2;
					continue;
				}
			} else if (stop < text.length) {
				// text.charCodeAt(stop) === PIPE
				if (close < stop + 1) close = stop + 1;
				while (close < text.length && text.charCodeAt(close) !== CLOSE) {
					close++;
				}
				if (close < text.length && text.charCodeAt(close + 1) === CLOSE) {
					out += text.slice(stop + 1, close); // [[target|alias]] → alias
					i = close + 2;
					continue;
				}
			}
		}
		out += text[i];
		i++;
	}
	return out;
}

/**
 * Pass 4 - strip ATX heading markers. Equivalent to
 * `replace(/^#+\s*|\s*#+$/g, "")`: a leading `#` run plus following whitespace,
 * and (independently, on what remains) a trailing `#` run plus the whitespace
 * run directly before it - the trailing alternative only fires when the string
 * actually ENDS with `#`. The old regex backtracked quadratically on interior
 * `#`/whitespace runs ("x" + "#".repeat(n) + "y").
 */
function trimAtxHashMarkers(text: string): string {
	let start = 0;
	if (text.charCodeAt(0) === HASH) {
		while (text.charCodeAt(start) === HASH) start++;
		while (start < text.length && isWhitespaceCodeUnit(text, start)) {
			start++;
		}
	}
	let end = text.length;
	if (end > start && text.charCodeAt(end - 1) === HASH) {
		while (end > start && text.charCodeAt(end - 1) === HASH) end--;
		while (end > start && isWhitespaceCodeUnit(text, end - 1)) end--;
	}
	return text.slice(start, end);
}

/**
 * Pass 5 - drop stray `[[` / `]]` pairs left by unmatched links. Equivalent to
 * `replace(/\[\[|\]\]/g, "")` (leftmost, non-overlapping).
 */
function stripStrayBrackets(text: string): string {
	let out = "";
	let i = 0;
	while (i < text.length) {
		const code = text.charCodeAt(i);
		if (
			(code === OPEN && text.charCodeAt(i + 1) === OPEN) ||
			(code === CLOSE && text.charCodeAt(i + 1) === CLOSE)
		) {
			i += 2;
			continue;
		}
		out += text[i];
		i++;
	}
	return out;
}

// Pass 3 - a bare single-character class has no quantifier to backtrack, so
// this one regex pass is already linear and stays.
const MD_CHARS_RE = /[*_`~]/g;

export function sanitizeHeading(heading: string): string {
	return stripStrayBrackets(
		trimAtxHashMarkers(
			resolveWikiLinks(stripImageEmbeds(heading)).replace(MD_CHARS_RE, ""),
		),
	).trim();
}
