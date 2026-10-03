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

// Mirrors Obsidian's internal heading-anchor normalizer (it replaces this
// punctuation class with spaces). Obsidian resolves a `#subpath` by comparing the
// normalized subpath against the normalized heading text, so to produce a link
// that lands on the right heading we must normalize the heading text the SAME
// way Obsidian does — replacing this whole punctuation class with spaces. This
// also neutralizes everything that would otherwise break the generated wikilink
// or be re-resolved by a later format pass: `[[ ]]` terminators, `|` aliases,
// `#`/`^` subpath markers, and `{` `}` (so a heading literally containing a
// QuickAdd token like `{{TITLE}}` can't have that token rewritten inside the
// generated link). CR/LF are included for CRLF buffers.
const OBSIDIAN_ANCHOR_STRIP = /[!"#$%&()*+,.:;<=>?@^`{|}~/[\]\\\r\n]/g;

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
 * Whether a line can serve as the text of a setext heading: a non-blank
 * paragraph line that is not itself a structural construct (ATX heading, fence,
 * blockquote, list item, or ≥4-space / tab-indented code line).
 */
function isSetextContentLine(line: string): boolean {
	if (line.trim() === "") return false;
	if (/^( {4,}|\t)/.test(line)) return false; // indented code
	if (/^ {0,3}#{1,6}[ \t]/.test(line)) return false; // ATX heading
	if (/^ {0,3}(`{3,}|~{3,})/.test(line)) return false; // fence
	if (/^ {0,3}>/.test(line)) return false; // blockquote
	if (/^ {0,3}([-*+]|\d{1,9}[.)])[ \t]/.test(line)) return false; // list item
	// A setext underline / `---`/`===` run / frontmatter-close delimiter is a
	// structural boundary, not paragraph text.
	if (/^ {0,3}(=+|-+)\s*$/.test(line)) return false;
	// Thematic breaks (***, ___, - - -, * * *).
	if (/^ {0,3}([*_-])([ \t]*\1){2,}[ \t]*$/.test(line)) return false;
	return true;
}

/**
 * The last line a heading occupies: a setext heading's underline, or an ATX
 * heading's own line. An ATX line always differs from its text by the `#`
 * marker; a setext heading's line is its text.
 */
export function headingEndLine(lines: string[], heading: SimpleHeading): number {
	return lines[heading.line]?.trim() === heading.heading
		? heading.line + 1
		: heading.line;
}

/**
 * For each line, whether it sits in a block that can't hold a heading: the
 * YAML frontmatter, a fenced code block, a `%%` comment block or a `$$` math
 * block, delimiters included. This is the one place that decides what counts
 * as such a block. HTML blocks are not detected.
 */
export function nonHeadingBlockLines(lines: string[]): boolean[] {
	const blocked = lines.map(() => false);
	const text = lines.map((line) => line.replace(/\r$/, ""));
	let i = 0;

	// YAML frontmatter: only when it opens on the very first line and closes.
	// Without a closing `---`, Obsidian reads the first line as a rule and the
	// rest as body.
	if (text.length > 0 && /^---\s*$/.test(text[0])) {
		let close = 1;
		while (close < text.length && !/^---\s*$/.test(text[close])) close++;
		if (close < text.length) {
			for (let j = 0; j <= close; j++) blocked[j] = true;
			i = close + 1;
		}
	}

	// Fenced code blocks (``` or ~~~, 3+, up to 3 spaces of indentation). An
	// opening fence may carry an info string (```js); a CLOSING fence must be
	// bare (only the same marker char, length >= the opener, then optional
	// whitespace), otherwise a content line like ```js would close the block. A
	// backtick fence's info string can't contain a backtick: ```inline``` is
	// inline code (CommonMark, and Obsidian). An unclosed fence runs to the end.
	let fence: { char: string; length: number } | null = null;
	let block: "%%" | "$$" | null = null;
	for (; i < text.length; i++) {
		const line = text[i];
		if (block) {
			blocked[i] = true;
			if (closesBlock(block, line)) block = null;
			continue;
		}
		if (fence) {
			blocked[i] = true;
			const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
			if (close && close[1][0] === fence.char && close[1].length >= fence.length) {
				fence = null;
			}
			continue;
		}
		const open = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
		if (open && !(open[1][0] === "`" && open[2].includes("`"))) {
			blocked[i] = true;
			fence = { char: open[1][0], length: open[1].length };
			continue;
		}
		// A comment (`%%`) or math (`$$`) block opens on a line that starts with
		// its marker, up to 3 spaces in, and doesn't close on that line. Right
		// after a list item, `$$` continues the item instead (`%%` still opens).
		const marker = line.match(/^ {0,3}(%%|\$\$)(.*)$/);
		const continuesListItem =
			i > 0 && /^\s*([-*+]|\d{1,9}[.)])[ \t]/.test(text[i - 1]);
		if (marker && !(marker[1] === "$$" && continuesListItem)) {
			const kind = marker[1] as "%%" | "$$";
			const rest = marker[2];
			const closedOnLine =
				kind === "%%"
					? rest.includes("%%")
					: rest.trimEnd().length > 2 && rest.trimEnd().endsWith("$$");
			if (!closedOnLine) {
				blocked[i] = true;
				block = kind;
			}
		}
	}

	return blocked;
}

/**
 * Obsidian closes a `%%` block at any line holding `%%`, and a `$$` block
 * only at a line that ends with `$$`. An unclosed block runs to the end.
 */
function closesBlock(block: "%%" | "$$", line: string): boolean {
	return block === "%%" ? line.includes("%%") : line.trimEnd().endsWith("$$");
}

/**
 * Extracts ATX (`# Heading`) and setext (`Heading` underlined by `===`/`---`)
 * headings from raw buffer lines, skipping YAML frontmatter and fenced code
 * blocks (a `# foo` line inside a ``` fence is NOT a heading in Obsidian) and
 * bounding ATX levels to 1–6. Used for editor text the metadata cache doesn't
 * cover yet, and to check that the cache is current. Unlike Obsidian, it
 * doesn't skip `#` lines inside HTML blocks.
 */
export function extractHeadingsFromLines(lines: string[]): SimpleHeading[] {
	const headings: SimpleHeading[] = [];
	const blocked = nonHeadingBlockLines(lines);

	for (let i = 0; i < lines.length; i++) {
		// A CRLF line keeps its `\r`; `.` in the ATX pattern would not match it.
		const line = lines[i].replace(/\r$/, "");
		if (blocked[i]) continue;

		// ATX heading. Up to 3 spaces of indentation only — a leading tab makes it
		// an indented code line (CommonMark/Obsidian), not a heading.
		const atx = line.match(/^ {0,3}(#{1,6})[ \t]+(.*)$/);
		if (atx) {
			headings.push({ heading: atx[2], level: atx[1].length, line: i });
			continue;
		}

		// Setext heading: a line of only `=` (level 1) or `-` (level 2) directly
		// under a single paragraph line. isSetextContentLine rejects a blank/
		// structural previous line (so a `---` thematic break or list dashes aren't
		// mistaken for an underline). A multi-line paragraph would make the WHOLE
		// paragraph the heading text in Obsidian; rather than reconstruct that, we
		// fall back (skip) when the line two above is also paragraph text, so we
		// never emit a partial (wrong) anchor.
		const setext = line.match(/^ {0,3}(=+|-+)\s*$/);
		if (setext && i > 0) {
			const prev = lines[i - 1];
			const prevAlreadyHeading =
				headings.length > 0 &&
				headings[headings.length - 1].line === i - 1;
			const prevIsSingleLineParagraph =
				i < 2 || blocked[i - 2] || !isSetextContentLine(lines[i - 2]);
			if (
				!prevAlreadyHeading &&
				!blocked[i - 1] &&
				prevIsSingleLineParagraph &&
				isSetextContentLine(prev)
			) {
				headings.push({
					heading: prev.trim(),
					level: setext[1][0] === "=" ? 1 : 2,
					line: i - 1,
				});
			}
			continue;
		}
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

	// Obsidian resolves subpaths case-insensitively (after the same punctuation
	// stripping), so uniqueness/collision must be compared case-insensitively —
	// `## Todo` and `## todo` resolve to the same heading. Emit original case.
	const targetKey = targetText.toLowerCase();
	const isUniqueText = !headings.some(
		(h, i) =>
			i !== targetIndex &&
			sanitizeHeadingForSubpath(h.heading).toLowerCase() === targetKey,
	);
	if (isUniqueText) return `#${targetText}`;

	const chain = ancestorChain(headings, targetIndex);
	// A single-segment chain can never disambiguate a duplicated text (Obsidian
	// resolves the bare `#text` to the first match).
	if (chain.length < 2) return null;

	const chainKey = chain.join("#");
	const chainKeyLower = chainKey.toLowerCase();
	const isUniqueChain = !buildAllChainKeysLower(headings).some(
		(key, i) => i !== targetIndex && key === chainKeyLower,
	);
	if (!isUniqueChain) return null; // unresolvable → whole-file fallback

	return `#${chainKey}`;
}

/**
 * Every heading's ancestor-chain key (lowercased), computed in one forward
 * pass with the standard outline parent stack - each heading's chain is its
 * stack-parent's chain plus itself, matching ancestorChain()'s backward walk.
 * Replaces calling the O(index) ancestorChain inside a .some() over all
 * headings, which was O(H^2) on a note flooded with duplicate headings
 * (chains are at most 6 deep - heading levels - so this is linear).
 */
function buildAllChainKeysLower(headings: SimpleHeading[]): string[] {
	const chains: string[][] = new Array(headings.length);
	const stack: number[] = []; // indices with strictly increasing levels
	for (let i = 0; i < headings.length; i++) {
		while (
			stack.length > 0 &&
			headings[stack[stack.length - 1]].level >= headings[i].level
		) {
			stack.pop();
		}
		const parentChain =
			stack.length > 0 ? chains[stack[stack.length - 1]] : [];
		const seg = sanitizeHeadingForSubpath(headings[i].heading);
		chains[i] = seg ? [...parentChain, seg] : parentChain;
		stack.push(i);
	}
	return chains.map((chain) => chain.join("#").toLowerCase());
}
