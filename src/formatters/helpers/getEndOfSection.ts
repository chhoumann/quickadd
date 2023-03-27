type Heading = {
	level: number;
	line: number;
};

function getMarkdownHeadings(bodyLines: string[]): Heading[] {
	const headers: Heading[] = [];

	bodyLines.forEach((line, index) => {
		const match = line.match(/^(#+)/);

		if (!match) return;

		headers.push({
			level: match[0].length,
			line: index,
		});
	});

	return headers;
}

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
	shouldConsiderSubsections = false
): number {
	const headings = getMarkdownHeadings(lines);

	const targetHeading = headings.find(
		(heading) => heading.line === targetLine
	);
	const targetIsNotHeading = !targetHeading;

    if (targetIsNotHeading && shouldConsiderSubsections) {
        throw new Error(
            `Target line ${targetLine} is not a heading, but we are trying to find the end of its section.`
        );
    }

	if (targetIsNotHeading) {
		const nextEmptyStringIdx = findNextIdx(
			lines,
			targetLine,
			(str: string) => str.trim() === ""
		);

		if (nextEmptyStringIdx !== null) {
			return nextEmptyStringIdx;
		}

		return targetLine;
	}

	const lastLineInBodyIdx = lines.length - 1;
	const endOfSectionLineIdx = getEndOfSectionLineByHeadings(
		targetHeading,
		headings,
		lastLineInBodyIdx
	);

	const lastNonEmptyLineInSectionIdx = findPriorIdx(
		lines,
		endOfSectionLineIdx,
		(str: string) => str.trim() !== ""
	);

	if (lastNonEmptyLineInSectionIdx !== null) {
		return lastNonEmptyLineInSectionIdx + 1;
	}

	return endOfSectionLineIdx;
}

function getEndOfSectionLineByHeadings(
	targetHeading: Heading,
	headings: Heading[],
	lastLineInBodyIdx: number
): number {
	const targetHeadingIsLastHeading = targetHeading.line === headings.length - 1;

	if (targetHeadingIsLastHeading) {
		return lastLineInBodyIdx;
	}

	const [nextHigherLevelHeadingIndex, foundHigherLevelHeading] =
		findNextHigherOrSameLevelHeading(
            targetHeading,
			headings
		);

	const higherLevelSectionIsLastHeading =
		foundHigherLevelHeading &&
		nextHigherLevelHeadingIndex === headings.length;

	if (foundHigherLevelHeading && !higherLevelSectionIsLastHeading) {
		// If the target section is the last section of its level, and there are higher level sections,
		const nextHigherLevelHeadingLineIdx =
			headings[nextHigherLevelHeadingIndex].line;
		return nextHigherLevelHeadingLineIdx - 1;
	}

	// End line of the section before the next section at same level as target.
	// There are no higher level sections, but there are more sections.
	return lastLineInBodyIdx;
}

function findNextHigherOrSameLevelHeading(
    targetHeading: Heading,
	headings: Heading[]
): readonly [number, boolean] {
    const targetHeadingIdx = headings.findIndex(
        (heading) => heading.level === targetHeading.level && heading.line === targetHeading.line
    );

    const nextSameOrHigherLevelHeadingIdx = findNextIdx(headings, targetHeadingIdx, (heading) => {
        return heading.level <= targetHeading.level;
    });

    if (nextSameOrHigherLevelHeadingIdx === null) {
        return [-1, false];
    }

    return [nextSameOrHigherLevelHeadingIdx, true];
}

function findPriorIdx<T>(
	items: T[],
	fromIdx: number,
	condition: (item: T) => boolean
): number | null {
	for (let i = fromIdx - 1; i >= 0; i--) {
		if (condition(items[i])) {
			return i;
		}
	}

	return null; // If no non-empty string is found before the given index
}

function findNextIdx<T>(
	items: T[],
	fromIdx: number,
	condition: (item: T) => boolean
): number | null {
	for (let i = fromIdx + 1; i < items.length; i++) {
		if (condition(items[i])) {
			return i;
		}
	}

	return null;
}
