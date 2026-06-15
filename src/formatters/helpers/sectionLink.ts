/**
 * Pure helpers for the {{linksection}} format token (issue #387): given the
 * file's headings and the cursor line, build the `#Heading` subpath that makes a
 * link to the current file scroll to the section the cursor is in.
 *
 * Kept App-free and side-effect-free so the heading parsing / selection /
 * disambiguation / sanitization logic is unit-testable without an Obsidian mock.
 * CompleteFormatter feeds it the active editor buffer + cursor line.
 */

export interface SimpleHeading {
	heading: string;
	level: number;
	/** 0-based line where the heading starts. */
	line: number;
}

// Mirrors Obsidian's internal heading-anchor normalizer (`LT` in app.js, which
// does `text.replace(AT, " ")`). Obsidian resolves a `#subpath` by comparing the
// normalized subpath against the normalized heading text, so to produce a link
// that lands on the right heading we must normalize the heading text the SAME
// way Obsidian does — replacing this whole punctuation class with spaces. This
// also neutralizes everything that would otherwise break the generated wikilink
// or be re-resolved by a later format pass: `[[ ]]` terminators, `|` aliases,
// `#`/`^` subpath markers, and `{` `}` (so a heading literally containing a
// QuickAdd token like `{{TITLE}}` can't have that token rewritten inside the
// generated link). CR/LF are included for CRLF buffers.
const OBSIDIAN_ANCHOR_STRIP = /[!"#$%&()*+,.:;<=>?@^`{|}~/\[\]\\\r\n]/g;

/**
 * Normalizes heading text into the form Obsidian uses to resolve a `#heading`
 * subpath, so the generated link reliably lands on that heading.
 */
export function sanitizeHeadingForSubpath(heading: string): string {
	return heading
		.replace(OBSIDIAN_ANCHOR_STRIP, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Extracts ATX headings from raw buffer lines, skipping YAML frontmatter and
 * fenced code blocks (a `# foo` line inside a ``` fence is NOT a heading in
 * Obsidian) and bounding the level to 1–6. Parsing the live buffer rather than
 * the metadata cache avoids cache lag for a just-typed or brand-new heading.
 */
export function extractHeadingsFromLines(lines: string[]): SimpleHeading[] {
	const headings: SimpleHeading[] = [];
	let inFence = false;
	let fenceChar = "";
	let fenceLen = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// YAML frontmatter: only when it opens on the very first line.
		if (i === 0 && /^---\s*$/.test(line)) {
			let j = i + 1;
			while (j < lines.length && !/^---\s*$/.test(lines[j])) j++;
			i = j; // land on the closing `---` (or EOF); the loop's ++ steps past it
			continue;
		}

		// Fenced code blocks (``` or ~~~, 3+). An opening fence may carry an info
		// string (```js); a CLOSING fence must be bare (only the same marker char,
		// length >= the opener, then optional whitespace) — otherwise a content
		// line like ```js inside the block would wrongly close it (CommonMark).
		if (!inFence) {
			const open = line.match(/^\s{0,3}(`{3,}|~{3,})/);
			if (open) {
				inFence = true;
				fenceChar = open[1][0];
				fenceLen = open[1].length;
				continue;
			}
		} else {
			const close = line.match(/^\s{0,3}(`{3,}|~{3,})\s*$/);
			if (
				close &&
				close[1][0] === fenceChar &&
				close[1].length >= fenceLen
			) {
				inFence = false;
				fenceChar = "";
				fenceLen = 0;
			}
			continue; // inside a fence: never parse headings
		}

		const m = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
		if (m) headings.push({ heading: m[2], level: m[1].length, line: i });
	}

	return headings;
}

/**
 * The sanitized ancestor chain for a heading: the heading itself preceded by the
 * nearest ancestor of each strictly-smaller level up to level 1. Empty (fully
 * normalized-away) segments are skipped so the chain never contains "##".
 */
function ancestorChain(headings: SimpleHeading[], index: number): string[] {
	const segments: string[] = [];
	const self = sanitizeHeadingForSubpath(headings[index].heading);
	if (self) segments.push(self);
	let level = headings[index].level;
	for (let i = index - 1; i >= 0 && level > 1; i--) {
		if (headings[i].level < level) {
			level = headings[i].level;
			const seg = sanitizeHeadingForSubpath(headings[i].heading);
			if (seg) segments.unshift(seg);
		}
	}
	return segments;
}

/**
 * Builds the subpath (`#Heading`, or the disambiguated `#Parent#…#Heading`) for
 * the nearest heading at or above `cursorLine`, or null when none applies (no
 * headings, the cursor is above the first heading, the heading normalizes empty,
 * or the link would still be ambiguous) — in which case the caller falls back to
 * a plain whole-file link rather than a link that resolves to the wrong place.
 *
 * Obsidian resolves a bare `#Heading` to the FIRST heading with that normalized
 * text, so when the chosen heading's text is not unique we emit the ancestor
 * chain. A duplicate that cannot grow at least one real ancestor segment (e.g. a
 * level-1 duplicate, or one whose only ancestor normalizes away), or whose full
 * chain still collides with another heading's chain, is genuinely unresolvable
 * by subpath, so we return null instead of a wrong-heading link.
 */
export function buildSectionSubpath(
	headings: SimpleHeading[],
	cursorLine: number,
): string | null {
	if (headings.length === 0) return null;

	let targetIndex = -1;
	for (let i = 0; i < headings.length; i++) {
		if (headings[i].line <= cursorLine) targetIndex = i;
		else break;
	}
	if (targetIndex === -1) return null; // cursor is above the first heading

	const targetText = sanitizeHeadingForSubpath(headings[targetIndex].heading);
	if (!targetText) return null; // heading has no usable anchor

	const isUniqueText = !headings.some(
		(h, i) =>
			i !== targetIndex &&
			sanitizeHeadingForSubpath(h.heading) === targetText,
	);
	if (isUniqueText) return `#${targetText}`;

	const chain = ancestorChain(headings, targetIndex);
	// A single-segment chain can never disambiguate a duplicated text (Obsidian
	// resolves the bare `#text` to the first match).
	if (chain.length < 2) return null;

	const chainKey = chain.join("#");
	const isUniqueChain = !headings.some(
		(_h, i) =>
			i !== targetIndex && ancestorChain(headings, i).join("#") === chainKey,
	);
	if (!isUniqueChain) return null; // unresolvable → whole-file fallback

	return `#${chainKey}`;
}
