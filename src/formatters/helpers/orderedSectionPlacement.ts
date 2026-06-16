import getEndOfSection, { getMarkdownHeadings } from "./getEndOfSection";
import type { SectionOrdering } from "../../types/choices/ICaptureChoice";

/**
 * Pure placement logic for the "ordered" create-if-not-found location (issue #481).
 *
 * Given a note's body lines and a new section heading that is known to be ABSENT,
 * compute WHERE the new heading should be created so that same-level sibling
 * sections stay sorted. It positions only the new section and assumes existing
 * siblings are already in order; it never re-sorts what is already there.
 *
 * The caller passes CRLF-stripped lines and a single first-line header, so this
 * module never sees `\r` or embedded newlines. Returned line indices are valid
 * against the SAME array that was passed in (fence masking preserves indices).
 */
export type OrderedSlot =
	| { mode: "bodyStart" }
	| { mode: "before"; line: number }
	| { mode: "after"; line: number };

/** A moment-like factory; injected so the helper stays App-free and testable. */
export type MomentLike = (
	input: string,
	format?: string,
	strict?: boolean,
) => { isValid(): boolean; valueOf(): number };

type ParsedKey = { value: number | string; parsed: boolean };

/**
 * Neutralize heading-like lines INSIDE fenced code blocks (``` / ~~~) so a `## x`
 * in a code sample is never mistaken for a sibling heading, while preserving line
 * indices AND non-blankness. Only the leading `#` run of a fenced heading-like
 * line is replaced (with a zero-width sentinel that `String.trim()` does not
 * strip), so the line stays non-blank: `getEndOfSection`'s blank-trimming still
 * spans a code block at a section's tail instead of cutting the section short.
 * Mirrors CommonMark loosely: an opening fence may carry an info string; a closing
 * fence is the same marker char, at least as long, with nothing after it. An
 * unclosed fence runs to EOF. Non-heading lines (incl. the fence markers) are kept
 * verbatim — they are already non-blank and non-heading.
 */
const FENCED_HEADING_SENTINEL = "​"; // zero-width space: non-blank to trim(), never a heading

export function maskFencedHeadings(lines: string[]): string[] {
	const out = lines.slice();
	let inFence = false;
	let fenceChar = "";
	let fenceLen = 0;

	for (let i = 0; i < lines.length; i++) {
		const match = lines[i].match(/^(\s*)(`{3,}|~{3,})/);
		if (!inFence) {
			if (match) {
				inFence = true;
				fenceChar = match[2][0];
				fenceLen = match[2].length;
			}
			continue;
		}

		// Inside a fence: neutralize only heading-like lines.
		out[i] = lines[i].replace(/^(\s*)#+(\s)/, `$1${FENCED_HEADING_SENTINEL}$2`);

		if (match && match[2][0] === fenceChar && match[2].length >= fenceLen) {
			const afterMarker = lines[i].slice(match[1].length + match[2].length);
			if (afterMarker.trim() === "") {
				inFence = false;
				fenceChar = "";
				fenceLen = 0;
			}
		}
	}

	return out;
}

function headingKeyText(line: string): string {
	return (line.match(/^#+\s+(.*)$/)?.[1] ?? "").trim();
}

function parseSemver(text: string): ParsedKey {
	// Tolerate a leading "[" (Keep a Changelog "## [1.10.0] - 2026-06-16") and a
	// "v" prefix; the leading-prefix match ignores any trailing " - date"/codename.
	const match =
		text.match(/^\[?v?(\d+)\.(\d+)\.(\d+)(?:[-+\]].*)?$/i) ??
		text.match(/^\[?v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/i);
	if (!match) return { value: 0, parsed: false };
	// Clamp each segment so packing into one comparable number can't alias
	// (e.g. minor 1_000_000 colliding with the next major).
	const seg = (s?: string) => Math.min(Number(s ?? "0"), 999_999);
	return {
		value: seg(match[1]) * 1e12 + seg(match[2]) * 1e6 + seg(match[3]),
		parsed: true,
	};
}

function parseKey(
	text: string,
	ob: SectionOrdering,
	moment?: MomentLike,
): ParsedKey {
	switch (ob.by) {
		case "lexical":
			return { value: text.toLocaleLowerCase(), parsed: true };
		case "numeric": {
			// Leading-number prefix, decoration-tolerant: "2. Roadmap" → 2.
			const match = text.match(/^-?\d+(?:\.\d+)?/);
			return match
				? { value: Number(match[0]), parsed: true }
				: { value: 0, parsed: false };
		}
		case "date": {
			// Lenient parse of the LEADING date, ignoring trailing decoration
			// ("2026-06-14 (Friday)"). Without an injected moment the date sort
			// degrades to unparseable (loud → append) rather than a silent lexical
			// fallback that would mask the real production path.
			const parsed = moment
				? moment(text, ob.dateFormat || undefined, false)
				: null;
			return parsed && parsed.isValid()
				? { value: parsed.valueOf(), parsed: true }
				: { value: 0, parsed: false };
		}
		case "semver":
			return parseSemver(text);
		default:
			return { value: 0, parsed: true }; // insertion
	}
}

function compareValues(a: ParsedKey, b: ParsedKey): number {
	if (typeof a.value === "string" && typeof b.value === "string") {
		return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
	}
	const an = a.value as number;
	const bn = b.value as number;
	return an < bn ? -1 : an > bn ? 1 : 0;
}

/**
 * Compute the slot for a new, absent section heading among its same-level
 * siblings. `level` and `newHeaderFirstLine` come from the resolved target
 * heading; `lines` is the CRLF-stripped body.
 *
 * `bodyStartLine` is the index of the first line AFTER any YAML frontmatter (0
 * when there is none). Headings before it are excluded so a `#`-prefixed YAML
 * line (e.g. a comment) is never treated as a sibling/ancestor and the new
 * section can never be spliced into the frontmatter block (issue #481).
 */
export function computeOrderedSectionInsertIndex(
	lines: string[],
	newHeaderFirstLine: string,
	level: number,
	ob: SectionOrdering,
	moment?: MomentLike,
	bodyStartLine = 0,
): OrderedSlot {
	const masked = maskFencedHeadings(lines);
	const headings = getMarkdownHeadings(masked).filter(
		(heading) => heading.line >= bodyStartLine,
	);
	const siblings = headings.filter((heading) => heading.level === level);
	const newKey = parseKey(headingKeyText(newHeaderFirstLine), ob, moment);

	// R1 (preamble pinned): with zero same-level siblings, nest the new section
	// after the nearest higher-level ancestor's WHOLE section (so an H1 title and
	// its blurb stay above), else at the body start.
	if (siblings.length === 0) {
		const ancestor = headings.filter((heading) => heading.level < level).pop();
		if (ancestor) {
			const end = getEndOfSection(masked, ancestor.line, true);
			return { mode: "after", line: end };
		}
		return { mode: "bodyStart" };
	}

	const appendAfterBand = (): OrderedSlot => {
		const last = siblings[siblings.length - 1];
		return { mode: "after", line: getEndOfSection(masked, last.line, true) };
	};

	// Insertion order: no parsing — prepend (desc) or append (asc) the band.
	if (ob.by === "insertion") {
		return ob.direction === "desc"
			? { mode: "before", line: siblings[0].line }
			: appendAfterBand();
	}

	// An unparseable NEW key is always appended at the band end (predictable),
	// independent of how EXISTING unparseable siblings are ranked.
	if (!newKey.parsed) return appendAfterBand();

	const sink = ob.unparseable ?? "bottom"; // governs EXISTING unparseable siblings
	for (const sibling of siblings) {
		const sibKey = parseKey(headingKeyText(masked[sibling.line]), ob, moment);
		let shouldPrecede: boolean;
		if (!sibKey.parsed) {
			// New key parsed, sibling not: place new ABOVE the sibling iff
			// unparseables sink to the bottom.
			shouldPrecede = sink === "bottom";
		} else {
			const c = compareValues(newKey, sibKey);
			shouldPrecede = ob.direction === "desc" ? c > 0 : c < 0;
		}
		if (shouldPrecede) return { mode: "before", line: sibling.line };
	}

	return appendAfterBand();
}
