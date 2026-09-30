import { extractHeadingsFromLines, headingEndLine, type SimpleHeading } from "./sectionLink";

type Heading = SimpleHeading;

/**
 *
 * @param lines Lines in body to find end of section
 * @param targetLine Target line to find end of section
 * @param shouldConsiderSubsections Whether to consider subsections as part of the section
 * @returns index of end of section
 */
export default function getEndOfSection(
	lines: string[],
	targetLine: number,
	shouldConsiderSubsections = false,
): number {
	// The same headings Obsidian sees: a `#` line inside a code fence or the
	// frontmatter is not one, and neither is a 7+ `#` run.
	const headings = extractHeadingsFromLines(lines);

	const targetHeading = headings.find((heading) => heading.line === targetLine);
	const targetIsHeading = !!targetHeading;

	if (!targetIsHeading && shouldConsiderSubsections) {
		throw new Error(
			`Target line ${targetLine} is not a heading, but we are trying to find the end of its section.`,
		);
	}

	// A block under a non-heading line (a paragraph, list, table or callout)
	// ends before the next blank line or heading, or at the end of the note.
	if (!targetIsHeading && !shouldConsiderSubsections) {
		const nextHeadingLine =
			headings.find((heading) => heading.line > targetLine)?.line ?? null;
		const nextBlankIdx = findNextIdx(
			lines,
			targetLine,
			(str: string) => str.trim() === "",
		);
		const stops = [nextHeadingLine, nextBlankIdx].filter(
			(idx): idx is number => idx !== null,
		);

		return stops.length > 0 ? Math.min(...stops) - 1 : lines.length - 1;
	}

	// The section runs up to the next heading, or with subsections up to the
	// next heading of the same or a higher level, or else to the end of the note.
	const target = targetHeading as Heading;
	const nextHeading = headings.find(
		(heading) =>
			heading.line > target.line &&
			(!shouldConsiderSubsections || heading.level <= target.level),
	);
	const sectionEnd = nextHeading?.line ?? lines.length;

	// It ends on its last non-blank line, and never inside its own heading (a
	// setext heading spans its text and underline).
	const targetEnd = headingEndLine(lines, target);
	let end = sectionEnd - 1;
	while (end > targetEnd && lines[end].trim() === "") end--;
	// An empty section under a heading on the note's first line ends on the
	// blank line after it, unlike an empty section anywhere else.
	if (end === 0 && lines[1]?.trim() === "") return 1;
	return Math.max(end, targetEnd);
}

function findNextIdx<T>(
	items: T[],
	fromIdx: number,
	condition: (item: T) => boolean,
): number | null {
	for (let i = fromIdx + 1; i < items.length; i++) {
		if (condition(items[i])) {
			return i;
		}
	}

	return null;
}
