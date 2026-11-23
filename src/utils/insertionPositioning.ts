import type { BlankLineAfterMatchMode } from "../types/choices/ICaptureChoice";
import { extractHeadingsFromLines } from "./sectionLink";
import { maskFencedHeadings, type OrderedSlot } from "./orderedSectionPlacement";
import { getBodyStartOffset } from "./noteContentInsertion";

/**
 * Pure positioning for capture insert-after/insert-before: the line range a
 * target occupies, where to splice, and the spliced string. Every input is a
 * parameter, so CRLF, frontmatter, fences, blank-line spacing and multi-line
 * anchors stay unit-testable.
 */

/** Inclusive line range a target occupies; `{ -1, -1 }` means "not found". */
export interface LineRange {
	start: number;
	end: number;
}

/**
 * Result of a splice: the new file content, plus the byte offset just past the
 * inserted text (or `null` when no trackable insertion happened). The caller
 * records the offset for cursor placement.
 */
export interface SpliceResult {
	content: string;
	insertedEndOffset: number | null;
}

/**
 * Splits a fully-expanded insert target into the anchor lines used for
 * matching. `\n` escapes in the target have already been turned into real
 * newlines (symmetric with the create-if-not-found path, which writes the
 * same expansion to disk), so a multi-line target like `**Today**\n***`
 * becomes `["**Today**", "***"]`.
 *
 * Trailing blank lines come from a trailing `\n` escape and are not part of
 * the anchor, so they are dropped: `**Today**\n` and `**Today**\n\n` both
 * collapse to the single-line anchor `["**Today**"]`. Interior blank lines
 * are preserved so a `## D\n\n**Tasks**` anchor still requires the blank.
 */
export function toTargetLines(expandedTarget: string): string[] {
	const lines = expandedTarget.split("\n");
	while (lines.length > 1 && lines[lines.length - 1].trim() === "") {
		lines.pop();
	}
	return lines;
}

export function isBlankTarget(targetLines: string[]): boolean {
	return (
		targetLines.length === 0 ||
		(targetLines.length === 1 && targetLines[0].trim() === "")
	);
}

/**
 * The inclusive line range the target occupies, or `{ -1, -1 }`. Insert-after
 * immediate anchors on `end`, insert-before on `start`, and insert-after-at-end
 * derives the section end from `start`.
 */
export function findInsertAfterRange(
	lines: string[],
	targetLines: string[],
): LineRange {
	if (targetLines.length <= 1) {
		const start = findSingleLineIndex(lines, targetLines[0] ?? "");
		return { start, end: start };
	}
	return findMultiLineRange(lines, targetLines);
}

export function findSingleLineIndex(lines: string[], rawTarget: string): number {
	// `\n` escapes are expanded upstream; stripping here would desync the search
	// from the create path, which writes the unstripped string.
	const target = rawTarget.trimEnd();
	let partialIndex = -1;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trimStart();

		if (line === target) return i;

		// A prefix match counts outright when only whitespace follows it.
		if (line.startsWith(target)) {
			const suffix = line.slice(target.length);
			if (/^\s*$/.test(suffix)) return i;

			if (partialIndex === -1) {
				partialIndex = i;
			}

			continue;
		}

		// Also match a substring with only whitespace after it, so selectors like
		// "| ----- |" match table separator rows.
		const targetIndex = line.indexOf(target);
		if (targetIndex !== -1) {
			const suffix = line.slice(targetIndex + target.length);
			if (/^\s*$/.test(suffix)) return i;

			if (partialIndex === -1) {
				partialIndex = i;
			}
		}
	}

	return partialIndex;
}

/**
 * Matches a multi-line target as a consecutive run of file lines. Only
 * TRAILING whitespace is stripped before comparison (on both sides), which
 * normalizes CRLF carriage returns and trailing spaces while preserving
 * LEADING indentation — `  - Parent\n    - Child` must not match a flat
 * `- Parent\n- Child`. Because the create path writes the target verbatim,
 * an indented anchor still round-trips. No fuzzy/partial fallback: a
 * multi-line anchor must match verbatim to avoid false positives.
 */
export function findMultiLineRange(
	lines: string[],
	targetLines: string[],
): LineRange {
	const n = targetLines.length;
	const normalizedTargets = targetLines.map((line) =>
		stripTrailingWhitespace(line),
	);

	for (let i = 0; i + n <= lines.length; i++) {
		let matched = true;
		for (let k = 0; k < n; k++) {
			if (stripTrailingWhitespace(lines[i + k]) !== normalizedTargets[k]) {
				matched = false;
				break;
			}
		}
		if (matched) return { start: i, end: i + n - 1 };
	}

	return { start: -1, end: -1 };
}

function stripTrailingWhitespace(line: string): string {
	// trimEnd strips the same characters as /\s+$/ in linear time; that regex
	// backtracked quadratically on long interior whitespace runs.
	return line.trimEnd();
}

/**
 * Only a heading anchor has subsections, and getEndOfSection throws for a
 * non-heading line, so degrade to false. A `#` line inside a code fence is not
 * a heading.
 */
export function anchorAllowsSubsections(
	considerSubsections: boolean,
	lines: string[],
	anchorLine: number,
): boolean {
	if (!considerSubsections) return false;
	return extractHeadingsFromLines(lines).some((heading) => heading.line === anchorLine);
}

export function shouldSkipBlankLinesAfterMatch(
	mode: BlankLineAfterMatchMode,
	line: string,
): boolean {
	if (mode === "skip") return true;
	if (mode === "none") return false;
	return isAtxHeading(line);
}

export function isAtxHeading(line: string): boolean {
	return /^\s{0,3}#{1,6}\s+\S/.test(line);
}

export function findInsertAfterPositionWithBlankLines(
	lines: string[],
	matchIndex: number,
	body: string,
	mode: BlankLineAfterMatchMode,
): number {
	if (matchIndex < 0) return matchIndex;

	const matchLine = lines[matchIndex] ?? "";
	const shouldSkip = shouldSkipBlankLinesAfterMatch(mode, matchLine);
	if (!shouldSkip) return matchIndex;

	// Ignore the trailing empty line that split("\n") leaves when the file ends
	// with a newline.
	const scanLimit = body.endsWith("\n")
		? Math.max(lines.length - 1, 0)
		: lines.length;
	let position = matchIndex;

	for (let i = matchIndex + 1; i < scanLimit; i++) {
		if (lines[i].trim().length === 0) {
			position = i;
			continue;
		}
		break;
	}

	return position;
}

export function findInsertAfterPositionAtSectionEnd(
	lines: string[],
	sectionEndIndex: number,
	fileContent: string,
	insertedText: string,
): number {
	if (sectionEndIndex < 0) return sectionEndIndex;

	let position = sectionEndIndex;
	let i = sectionEndIndex + 1;

	while (i < lines.length && lines[i].trim().length === 0) {
		position = i;
		i++;
	}

	// Insert at the section end when there are no trailing blank lines or the
	// blanks are followed by content (e.g. before a new heading).
	if (position === sectionEndIndex || i !== lines.length) {
		return sectionEndIndex;
	}

	// For entries without trailing newline, keep insertion anchored at the
	// section end so repeated captures preserve order.
	if (!insertedText.endsWith("\n")) {
		return sectionEndIndex;
	}

	// split("\n") keeps a trailing empty string when content ends in "\n".
	// We keep one trailing slot so the next insertion preserves capture spacing
	// without introducing an extra blank line before the inserted text.
	if (fileContent.endsWith("\n")) {
		return Math.max(sectionEndIndex, position - 1);
	}

	return position;
}

export function hasInlineTargetLinebreak(target: string): boolean {
	return target.includes("\n") || target.includes("\r");
}

export function getInlineEndOfLine(
	fileContent: string,
	startIndex: number,
): number {
	const newlineIndex = fileContent.indexOf("\n", startIndex);
	if (newlineIndex === -1) return fileContent.length;
	if (newlineIndex > 0 && fileContent[newlineIndex - 1] === "\r") {
		return newlineIndex - 1;
	}
	return newlineIndex;
}

/**
 * Index of the first body line after any YAML frontmatter (0 when none).
 * Mirrors insertAtNoteBodyStart's frontmatter detection (getBodyStartOffset).
 */
export function getBodyStartLine(fileContent: string): number {
	const bodyStartOffset = getBodyStartOffset(fileContent);
	return bodyStartOffset > 0
		? fileContent.slice(0, bodyStartOffset).split("\n").length - 1
		: 0;
}

export function isHeadingLine(line: string): boolean {
	return extractHeadingsFromLines([line.replace(/\r$/, "")]).length > 0;
}

/** Blanks every line that doesn't start a heading, keeping line indices. */
export function onlyHeadingLines(lines: string[]): string[] {
	const headingLines = new Set(
		extractHeadingsFromLines(lines.map((line) => line.replace(/\r$/, ""))).map(
			(heading) => heading.line,
		),
	);
	return lines.map((line, index) => (headingLines.has(index) ? line : ""));
}

/**
 * Returns CRLF-stripped lines with frontmatter lines blanked and fenced-code
 * headings neutralized, so the ordered target search never matches a heading
 * that isn't a real body section. Line indices are preserved.
 */
export function maskNonBodyHeadingsForSearch(
	lines: string[],
	fileContent: string,
): string[] {
	// Blank the frontmatter before fence masking: an unclosed fence marker in the
	// YAML would otherwise leave the scanner "in a fence" and neutralize a real
	// body heading.
	const bodyStartLine = getBodyStartLine(fileContent);
	const bodyScopedLines = lines.map((line, index) =>
		index < bodyStartLine ? "" : line,
	);
	return maskFencedHeadings(bodyScopedLines).map((line) =>
		line.replace(/\r$/, ""),
	);
}

export function insertTextAfterPositionInBody(
	rawText: string,
	body: string,
	pos: number,
	isTask: boolean,
	cursorOffsetInText = rawText.length,
): SpliceResult {
	// Line-matched callers always pass a real index (>= 0); frontmatter-aware
	// "top" insertion lives in insertAtNoteBodyStart.
	const splitContent = body.split("\n");
	const pre = splitContent.slice(0, pos + 1).join("\n");
	const post = splitContent.slice(pos + 1).join("\n");

	// "Format as task" appends a newline so a bare task is a complete line. Above
	// a blank line that newline is dropped so the task takes the blank line's
	// place; a user-typed trailing newline is left alone. The blank line is found
	// by split index so whitespace-only and CRLF blanks count, while the EOF slot
	// of a body ending in a newline does not.
	const lineBelow = splitContent[pos + 1];
	const lineBelowTrimmed = (lineBelow ?? "").trim();
	const isTrailingNewlineArtifact =
		body.endsWith("\n") && pos + 1 === splitContent.length - 1;
	const blankLineDirectlyBelow =
		pos + 1 < splitContent.length &&
		!isTrailingNewlineArtifact &&
		lineBelowTrimmed === "";
	const text =
		isTask && rawText.endsWith("\n") && blankLineDirectlyBelow
			? rawText.slice(0, -1)
			: rawText;

	// `post` starts with the following line, so a `text` without a trailing
	// newline would merge into it or replace a blank line. Judged on `rawText`,
	// so the task drop above stays a drop.
	const separator = !rawText.endsWith("\n") && post.length > 0 ? "\n" : "";

	return {
		content: `${pre}\n${text}${separator}${post}`,
		insertedEndOffset: pre.length + 1 + Math.min(cursorOffsetInText, text.length),
	};
}

export function insertTextBeforePositionInBody(
	text: string,
	body: string,
	pos: number,
	cursorOffsetInText = text.length,
): SpliceResult {
	const separator = body.length > 0 && !text.endsWith("\n") ? "\n" : "";
	const clampedOffset = Math.max(0, Math.min(cursorOffsetInText, text.length));

	if (pos <= 0) {
		return {
			content: `${text}${separator}${body}`,
			insertedEndOffset: clampedOffset,
		};
	}

	const splitContent = body.split("\n");
	const pre = splitContent.slice(0, pos).join("\n");
	const post = splitContent.slice(pos).join("\n");

	return {
		content: `${pre}\n${text}${separator}${post}`,
		insertedEndOffset: pre.length + 1 + clampedOffset,
	};
}

/**
 * Splices a created section at the resolved slot, padding a blank line above
 * the heading and below the block when the neighbours are non-blank.
 * Byte-preserving: the text on both sides is kept verbatim, so a mixed-EOL note
 * is never normalized; only the inserted block and its seams use the dominant EOL.
 */
export function spliceOrderedSection(
	rawLines: string[],
	slot: Exclude<OrderedSlot, { mode: "bodyStart" }>,
	payload: string,
	fileContent: string,
	cursorOffsetInPayload?: number,
): SpliceResult {
	const content = fileContent;
	const eol = content.includes("\r\n") ? "\r\n" : "\n";
	const insertIdx = slot.mode === "before" ? slot.line : slot.line + 1;

	// Character offset of the start of line `insertIdx` in the original content.
	let offset = 0;
	for (let i = 0; i < insertIdx && i < rawLines.length; i++) {
		offset += rawLines[i].length + 1; // +1 for the consumed "\n"
	}
	if (offset > content.length) offset = content.length;
	const before = content.slice(0, offset);
	const after = content.slice(offset);

	const prev =
		insertIdx > 0 ? (rawLines[insertIdx - 1] ?? "").replace(/\r$/, "") : "";
	const next =
		insertIdx < rawLines.length
			? (rawLines[insertIdx] ?? "").replace(/\r$/, "")
			: "";

	const payloadLines = payload.split("\n").map((line) => line.replace(/\r$/, ""));
	// Drop a single trailing empty line that a format ending in "\n" produces, so
	// separation is controlled solely by the padding below.
	if (payloadLines.length > 1 && payloadLines[payloadLines.length - 1] === "") {
		payloadLines.pop();
	}

	const blockLines: string[] = [];
	if (insertIdx > 0 && prev.trim() !== "") blockLines.push(""); // blank above heading
	blockLines.push(...payloadLines);
	if (insertIdx < rawLines.length && next.trim() !== "") blockLines.push(""); // blank below block

	const blockText = blockLines.join(eol);
	// Terminate the preceding line when `before` doesn't already end with a
	// newline (the EOF-without-trailing-newline case), and terminate the block
	// when content follows it OR when the file already ended with a newline (so
	// appending at EOF preserves the file's trailing newline). Existing bytes in
	// before/after stay verbatim.
	const lead = before.length > 0 && !/\n$/.test(before) ? eol : "";
	const trail = after.length > 0 || /\n$/.test(content) ? eol : "";
	const insertedStartOffset = before.length + lead.length;
	return {
		content: `${before}${lead}${blockText}${trail}${after}`,
		insertedEndOffset: insertedStartOffset + (cursorOffsetInPayload === undefined
			? blockText.length
			: (insertIdx > 0 && prev.trim() !== "" ? eol.length : 0) + Math.min(
				payload.slice(0, cursorOffsetInPayload).split("\n").map(line => line.replace(/\r$/, "")).join(eol).length,
				payloadLines.join(eol).length,
			)),
	};
}
