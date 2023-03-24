import { escapeRegExp, getLinesInString } from "src/utility";

type ErrorType = "NOT FOUND";
type ReturnType =
	| { success: boolean; value: string }
	| { success: false; error: ErrorType };

/**
 * Inserts a string after another string in a body of text
 * @param target String to insert after
 * @param value What to insert
 * @param body The body where the insertion should occur
 * @returns A string with the value inserted after the target
 */
export default function insertAfter(
	target: string,
	value: string,
	body: string,
	options: { insertAtEndOfSection?: boolean } = {}
): ReturnType {
	const targetRegex = new RegExp(
		`\\s*${escapeRegExp(target.replace("\\n", ""))}\\s*`
	);
	const fileContentLines: string[] = getLinesInString(body);

	let targetPosition = fileContentLines.findIndex((line) =>
		targetRegex.test(line)
	);

	const targetFound = targetPosition !== -1;
	if (!targetFound) {
		return { success: false, error: "NOT FOUND" };
	}

	if (options.insertAtEndOfSection) {
		const nextHeaderPositionAfterTargetPosition = fileContentLines
			.slice(targetPosition + 1)
			.findIndex((line) => /^#+ |---/.test(line));
		const foundNextHeader = nextHeaderPositionAfterTargetPosition !== -1;

		let endOfSectionIndex: number | null = null;
		if (foundNextHeader) {
			for (
				let i = nextHeaderPositionAfterTargetPosition + targetPosition;
				i > targetPosition;
				i--
			) {
				const lineIsNewline: boolean = /^[\s\n ]*$/.test(
					fileContentLines[i]
				);

				if (!lineIsNewline) {
					endOfSectionIndex = i;
					break;
				}
			}

			if (!endOfSectionIndex) endOfSectionIndex = targetPosition;
            targetPosition = endOfSectionIndex;
		} else {
            targetPosition = fileContentLines.length - 1;
		}
	}

    const insertedAfter = insertTextAfterPositionInBody(
        value,
        body,
        targetPosition
    );

    return { success: true, value: insertedAfter };
}

function insertTextAfterPositionInBody(
	text: string,
	body: string,
	pos: number
): string {
	const splitContent = body.split("\n");
	const pre = splitContent.slice(0, pos + 1).join("\n");
	const post = splitContent.slice(pos + 1).join("\n");

	return `${pre}\n${text}${post}`;
}
