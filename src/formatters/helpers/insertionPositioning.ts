import type { BlankLineAfterMatchMode } from "../../types/choices/ICaptureChoice";
import { getMarkdownHeadings } from "./getEndOfSection";
import { maskFencedHeadings, type OrderedSlot } from "./orderedSectionPlacement";
import { getBodyStartOffset } from "../../utils/noteContentInsertion";

/**
 * Pure document-positioning algorithms for the capture insert-after / insert-before
 * flows. Given a note's lines (or raw content) and a resolved target, these compute
 * WHERE captured content should land — the line range a target occupies, the line
 * after which to splice, and the resulting spliced string. They never touch the
 * Obsidian app, the formatter's prompt state, or any instance: every input arrives
 * as a parameter and the result is returned, which keeps the gnarly edge-case logic
 * (CRLF, frontmatter, fenced code, blank-line spacing, EOF newlines, #312 task
 * spacing, #742 multi-line anchors) independently unit-testable and out of the
 * CaptureChoiceFormatter token-substitution path.
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
 * Locates the insert target in the file. Returns the inclusive line range
 * `{ start, end }` the target occupies, or `{ start: -1, end: -1 }` when not
 * found. For a single-line target `start === end`, preserving historical
 * single-line behavior exactly. Callers pick which boundary to anchor on:
 * insert-after-immediate uses `end`, insert-before uses `start`,
 * insert-after-at-end derives the section end from `start` (issue #742).
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
	// `\n` escapes are already expanded upstream, so no escape stripping
	// happens here — stripping would desync search from the create path,
	// which writes the unstripped string (issue #742).
	const target = rawTarget.trimEnd();
	let partialIndex = -1;

	for (let i = 0; i < lines.length; i++) {
		// Trim only left whitespace to preserve indentation alignment
		const line = lines[i].trimStart();

		// 1. Exact match wins immediately
		if (line === target) return i;

		// 2. Check for prefix match (target + only whitespace suffix)
		// This matches old regex behavior for lines starting with the target
		if (line.startsWith(target)) {
			const suffix = line.slice(target.length);
			// If suffix is only whitespace, this matches old regex behavior exactly
			if (/^\s*$/.test(suffix)) return i;

			// Remember first broader prefix match as fallback
			if (partialIndex === -1) {
				partialIndex = i;
			}

			continue;
		}

		// 3. Check for substring match (target appears anywhere in line with only whitespace after)
		// This restores legacy behavior where selectors like "| ----- |" can match
		// table separator rows where the target appears at the end
		const targetIndex = line.indexOf(target);
		if (targetIndex !== -1) {
			const suffix = line.slice(targetIndex + target.length);
			// If suffix is only whitespace, match this line
			if (/^\s*$/.test(suffix)) return i;

			// Remember first broader substring match as fallback
			if (partialIndex === -1) {
				partialIndex = i;
			}
		}
	}

	return partialIndex; // -1 if no match at all
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
	// trimEnd() strips exactly the same character set as the historical
	// /\s+$/ replace (ECMAScript WhiteSpace + LineTerminator) but in linear
	// time. The unanchored regex backtracked quadratically on a note line
	// holding a long interior whitespace run (" ".repeat(n) + "x"), freezing
	// the UI during a multi-line insert-after/-before capture search.
	return line.trimEnd();
}

/**
 * `considerSubsections` only has meaning for a heading anchor — a non-heading
 * line has no section whose subsections could be included, and
 * getEndOfSection() throws if asked to consider subsections of a non-heading
 * line. Multi-line anchors made non-heading start lines newly matchable
 * (issue #742), so degrade to false when the anchor is not a heading
 * (using getEndOfSection's own heading definition) instead of throwing.
 */
export function anchorAllowsSubsections(
	considerSubsections: boolean,
	lines: string[],
	anchorLine: number,
): boolean {
	if (!considerSubsections) return false;
	return getMarkdownHeadings([lines[anchorLine] ?? ""]).length > 0;
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

	// Ignore the trailing empty line that results from split("\n") when the
	// file ends with a newline. This preserves existing EOF behavior.
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

	// Preserve current behavior when there are no trailing blank lines or when
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

/**
 * Returns CRLF-stripped lines with frontmatter lines blanked and fenced-code
 * headings neutralized, so the ordered target search never matches a heading
 * that isn't a real body section. Line indices are preserved.
 */
export function maskNonBodyHeadingsForSearch(
	lines: string[],
	fileContent: string,
): string[] {
	// Blank the frontmatter lines BEFORE fence masking, not after: maskFencedHeadings
	// scans every line it is given, so an unclosed ```/~~~ marker inside the YAML
	// frontmatter (e.g. a block scalar holding a code-fence example) would otherwise
	// leave the scanner "in a fence" at the body boundary and neutralize a real body
	// heading. Scoping the masking to the body avoids that leak. For frontmatter
	// without fence markers this is identical to masking first then blanking.
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
): SpliceResult {
	// Line-matched insertAfter callers always pass a real line index (>= 0); the
	// frontmatter-aware "top" insertion lives in insertAtNoteBodyStart instead.
	// Shared by every "after" path: the line-matched handler, insert-at-end-of-
	// section, and the create-if-not-found cursor paths.
	const splitContent = body.split("\n");
	const pre = splitContent.slice(0, pos + 1).join("\n");
	const post = splitContent.slice(pos + 1).join("\n");

	// "Format as task" injects a trailing newline onto the capture content
	// (getCaptureContent in CaptureChoiceEngine) so a bare task is always a
	// complete line. When the line directly below the insertion point is already
	// blank, that injected newline stacks on top of the existing blank line and
	// renders a spurious blank line AFTER the task (issue #312) — an asymmetry
	// the user does not see without the task option. Drop the redundant injected
	// newline in that case; the existing blank line still separates the task from
	// the following content. A user-typed trailing newline in the format string
	// is intentional content and is left untouched (gated on choice.task, this
	// only collapses QuickAdd's own injected task newline).
	//
	// Detect the blank line via the split index, not `post.startsWith("\n")`, so
	// whitespace-only and CRLF blanks (where the line is "\r" or "   ", not "")
	// are recognised too. When `body` ends in a newline, split() appends a
	// trailing empty slot that is the EOF artifact, not a real blank line, so it
	// must not trigger the drop; a body WITHOUT a trailing newline has no such
	// artifact, so its final slot is a genuine (possibly blank) last line.
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

	// `post` starts with the following line's CONTENT (join adds no leading
	// "\n"), so a `text` without a trailing newline would be glued straight
	// onto it - "## Log\n- existing" + "new" became "## Log\nnew- existing".
	// Mirror insertTextBeforePositionInBody's separator guard. Only a
	// non-blank line below needs the separator: a blank/whitespace-only line
	// absorbs the text instead (the #312 task-newline drop above relies on
	// exactly that), and the EOF artifact slot is not content.
	const separator =
		!text.endsWith("\n") && lineBelowTrimmed !== "" ? "\n" : "";

	return {
		content: `${pre}\n${text}${separator}${post}`,
		insertedEndOffset: pre.length + 1 + text.length,
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
 * Splice a created section at the resolved slot, padding it with a single blank
 * line above the heading (when the preceding line is non-blank) and below the
 * block (when the following line is non-blank) so the heading is never glued to
 * neighbouring content (the helpers QuickAdd ships do not pad headings —
 * verified — so this is the dedicated separation path for ordered creation).
 *
 * Byte-preserving: the original `fileContent` is sliced at the insertion offset
 * and the existing text on both sides is kept VERBATIM (so a mixed-EOL note is
 * never wholesale-normalized — an ordered capture produces a minimal diff). Only
 * the inserted block and its two seams use the file's dominant EOL. The offset
 * is derived from `rawLines` (which `getLinesInString` produced by splitting on
 * "\n", so each prior line consumed its own length + 1 for the "\n"). `\r` is
 * stripped only for the blank-line trim checks.
 */
export function spliceOrderedSection(
	rawLines: string[],
	slot: Exclude<OrderedSlot, { mode: "bodyStart" }>,
	payload: string,
	fileContent: string,
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
		insertedEndOffset: insertedStartOffset + blockText.length,
	};
}
