import { surroundCapture, placeCapture, type CapturePlacementResult } from "../../utils/capturePlacement";
import type ICaptureChoice from "../../types/choices/ICaptureChoice";
import { insertAtNoteBodyStartWithResult } from "../../utils/noteContentInsertion";
import getEndOfSection from "../../utils/getEndOfSection";
import { extractHeadingsFromLines } from "../../utils/sectionLink";
import { computeOrderedSectionInsertIndex, maskFencedHeadings, type MomentLike } from "../../utils/orderedSectionPlacement";
import * as positioning from "../../utils/insertionPositioning";

/** The capture at the top of the note body, below any front matter. */
export function placeAtNoteBodyStart(
	payload: CapturePlacementResult,
	fileContent: string,
	separateBlockquotes = false,
): CapturePlacementResult {
	const result = insertAtNoteBodyStartWithResult(fileContent, payload.content, { separateBlockquotes });
	return placeCapture(payload, result.content, result.insertedStartOffset === null || payload.cursor.kind === "none"
		? null : result.insertedStartOffset + payload.cursor.value);
}

/** The capture on the lines after line `position` of the note. */
export function placeAfterLine(
	payload: CapturePlacementResult,
	fileContent: string,
	position: number,
	task: boolean,
): CapturePlacementResult {
	const result = positioning.insertTextAfterPositionInBody(payload.content, fileContent, position, task,
		payload.cursor.kind === "offset" ? payload.cursor.value : undefined);
	return placeCapture(payload, result.content, result.insertedEndOffset);
}

/**
 * The line after which `text` goes at the end of the section `anchorLine`
 * starts. `lastAnchorLine` is a multi-line anchor's last line, which the text
 * never goes inside.
 */
export function sectionEndPosition({ lines, anchorLine, lastAnchorLine = anchorLine, considerSubsections, fileContent, text }: {
	lines: string[];
	anchorLine: number;
	lastAnchorLine?: number;
	considerSubsections: boolean;
	fileContent: string;
	text: string;
}): number {
	const end = getEndOfSection(lines, anchorLine,
		positioning.anchorAllowsSubsections(considerSubsections, lines, anchorLine));
	return positioning.findInsertAfterPositionAtSectionEnd(lines, Math.max(end, lastAnchorLine), fileContent, text);
}

export function insertOrderedCapture({ capture, targetString, fileContent, insertAfter, task }: {
	capture: CapturePlacementResult;
	targetString: string;
	fileContent: string;
	insertAfter: ICaptureChoice["insertAfter"];
	task: boolean;
}): CapturePlacementResult {
	const formatted = capture.content;
	const orderBy = insertAfter?.orderBy ?? {
		by: "insertion" as const,
		direction: "desc" as const,
		unparseable: "bottom" as const,
	};

	const firstLine = targetString.split(/\r?\n/, 1)[0];
	const level = extractHeadingsFromLines([firstLine])[0]?.level ?? 0;

	// Reused verbatim so the created block is byte-identical to the next run's
	// search target, which keeps creation idempotent.
	const payload = surroundCapture(capture, `${targetString}\n`);
	const atBodyStart = () => placeAtNoteBodyStart(payload, fileContent, true);

	// Non-heading anchor: ordered placement is meaningless → graceful TOP degrade.
	if (level === 0) {
		return atBodyStart();
	}

	// CRLF-safe line model: the helper detects headings on \r-stripped lines;
	// the splice happens on the original lines to preserve EOL bytes.
	const rawLines = fileContent.split("\n");
	const lines = rawLines.map((line) => line.replace(/\r$/, ""));

	// Exclude any YAML frontmatter so a `#`-prefixed YAML line is never treated
	// as a sibling/ancestor and the new section can never be spliced into the
	// frontmatter block (frontmatter detection mirrors insertAtNoteBodyStart).
	const bodyStartLine = positioning.getBodyStartLine(fileContent);

	// Idempotency guard for multi-line anchors: the block search (findInsertAfterRange)
	// matches the WHOLE multi-line target, so a target like "## 2026-06-16\n**Tasks**"
	// is "not found" when the note already has a bare "## 2026-06-16" without the
	// **Tasks** line — which would otherwise create a DUPLICATE heading here. When the
	// heading line itself already exists in the body, insert the content under it
	// instead (top of section, or section end when insertAtEnd), never duplicating.
	// Match against fence-masked lines so a `## …` inside a code block is not
	// mistaken for a real heading (consistent with computeOrderedSectionInsertIndex).
	const maskedLines = maskFencedHeadings(lines);
	const headingNeedle = firstLine.replace(/\r$/, "").trimEnd();
	const existingHeadingLine = maskedLines.findIndex(
		(line, i) => i >= bodyStartLine && line.trimEnd() === headingNeedle,
	);
	if (existingHeadingLine !== -1) {
		const position = insertAfter?.insertAtEnd
			? sectionEndPosition({
				lines: maskedLines, anchorLine: existingHeadingLine,
				considerSubsections: !!insertAfter?.considerSubsections, fileContent, text: formatted,
			})
			: positioning.findInsertAfterPositionWithBlankLines(
					maskedLines,
					existingHeadingLine,
					fileContent,
					insertAfter?.blankLineAfterMatchMode ?? "auto",
				);
		return placeAfterLine(capture, fileContent, position, task);
	}

	const moment =
		typeof window !== "undefined"
			? (window.moment as unknown as MomentLike | undefined)
			: undefined;
	const slot = computeOrderedSectionInsertIndex(
		lines,
		firstLine,
		level,
		orderBy,
		moment,
		bodyStartLine,
	);

	if (slot.mode === "bodyStart") {
		return atBodyStart();
	}

	const result = positioning.spliceOrderedSection(rawLines, slot, payload.content, fileContent,
		payload.cursor.kind === "offset" && payload.cursor.source === "marker" ? payload.cursor.value : undefined);
	return placeCapture(payload, result.content, result.insertedEndOffset);
}
