import { getLinesInString } from "../../utility";
import type ICaptureChoice from "../../types/choices/ICaptureChoice";
import { insertAtNoteBodyStartWithResult } from "../../utils/noteContentInsertion";
import getEndOfSection, { getMarkdownHeadings } from "./getEndOfSection";
import { computeOrderedSectionInsertIndex, maskFencedHeadings, type MomentLike } from "./orderedSectionPlacement";
import * as positioning from "./insertionPositioning";

export function insertOrderedCapture({ formatted, targetString, fileContent, insertAfter, task }: {
	formatted: string;
	targetString: string;
	fileContent: string;
	insertAfter: ICaptureChoice["insertAfter"];
	task: boolean;
}): positioning.SpliceResult {
	const orderBy = insertAfter?.orderBy ?? {
		by: "insertion" as const,
		direction: "desc" as const,
		unparseable: "bottom" as const,
	};

	const firstLine = targetString.split(/\r?\n/, 1)[0];
	const level = getMarkdownHeadings([firstLine])[0]?.level ?? 0;

	// Reused verbatim so the created block is byte-identical to next-run's search
	// target (the #742 round-trip invariant that keeps creation idempotent).
	const payload = `${targetString}\n${formatted}`;

	// Non-heading anchor: ordered placement is meaningless → graceful TOP degrade.
	if (level === 0) {
		return insertAtNoteBodyStartWithResult(fileContent, payload);
	}

	// CRLF-safe line model: the helper detects headings on \r-stripped lines;
	// the splice happens on the original lines to preserve EOL bytes.
	const rawLines = getLinesInString(fileContent);
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
			? positioning.findInsertAfterPositionAtSectionEnd(
					maskedLines,
					getEndOfSection(
						maskedLines,
						existingHeadingLine,
						positioning.anchorAllowsSubsections(!!insertAfter?.considerSubsections,
							maskedLines,
							existingHeadingLine,
						),
					) ?? maskedLines.length - 1,
					fileContent,
					formatted,
				)
			: positioning.findInsertAfterPositionWithBlankLines(
					maskedLines,
					existingHeadingLine,
					fileContent,
					insertAfter?.blankLineAfterMatchMode ?? "auto",
				);
		return positioning.insertTextAfterPositionInBody(formatted, fileContent, position, task);
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
		return insertAtNoteBodyStartWithResult(fileContent, payload);
	}

	return positioning.spliceOrderedSection(rawLines, slot, payload, fileContent);
}
