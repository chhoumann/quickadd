type Heading = {
	level: number;
	line: number;
};

export default function getEndOfSection(
	headings: Heading[],
	lines: string[],
	targetLine: number
): number {
	const targetSectionIndex = headings.findIndex(
		(heading) => heading.line === targetLine
	);

	const lastLineIdx = lines.length - 1;

	if (
		targetSectionIndex === -1 ||
		targetSectionIndex === headings.length - 1
	) {
		// If there's no target section or it's the last section, return the last line in the body.
		return lastLineIdx;
	}

	let endOfSectionLine = targetLine;

	const targetSectionLevel = headings[targetSectionIndex].level;

	const [nextHigherLevelIndex, foundHigherLevelSection] = findNextHigherOrSameLevelHeading(
		targetSectionIndex,
		targetSectionLevel,
		headings
	);

    const higherLevelSectionIsLastSection = nextHigherLevelIndex === headings.length;
	if (foundHigherLevelSection && higherLevelSectionIsLastSection) {
		// If the target section is the last section of its level or there are no higher level sections, return the end line of the file.
		endOfSectionLine = lastLineIdx;
	} else if (foundHigherLevelSection) {
		// If the target section is the last section of its level, and there are higher level sections,
		const nextHigherLevelSection = headings[nextHigherLevelIndex].line;
		endOfSectionLine = nextHigherLevelSection - 1;
	} else {
		// End line of the section before the next section at same level as target.
		// There are no higher level sections, but there are more sections.
        endOfSectionLine = lastLineIdx;
	}

	const nonEmptyLineIdx = findNonEmptyStringIndexPriorToGivenIndex(
		lines,
		endOfSectionLine
	);

	if (nonEmptyLineIdx !== null) {
		endOfSectionLine = nonEmptyLineIdx + 1;
	}

	return endOfSectionLine;
}

function findNextHigherOrSameLevelHeading(
	targetSectionIndex: number,
	targetSectionLevel: number,
	headings: Heading[]
): readonly [number, boolean] {
	for (let i = targetSectionIndex + 1; i < headings.length; i++) {
		if (headings[i].level <= targetSectionLevel) {
			return [i, true];
		}
	}

	return [-1, false];
}

function findNonEmptyStringIndexPriorToGivenIndex(
	strings: string[],
	givenIndex: number
): number | null {
	for (let i = givenIndex - 1; i >= 0; i--) {
		if (strings[i].trim() !== "") {
			return i;
		}
	}

	return null; // If no non-empty string is found before the given index
}
