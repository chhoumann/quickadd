import {
	extractBareFlagPart,
	parseBooleanFlag,
	parsePipeKeyValue,
	splitPipeParts,
} from "./pipeSyntax";

export type ParsedVDateOptions = {
	defaultValue?: string;
	optional: boolean;
};

/**
 * Parses the post-pipe segment of a {{VDATE:name,format|...}} token.
 *
 * DATE_VARIABLE_REGEX's third capture group swallows everything after the
 * first pipe, so the segment may itself contain pipes. Parts that spell the
 * `optional` flag (bare or keyed `optional:<bool>`) are extracted; the
 * remaining parts are re-joined verbatim to form the natural-language
 * default, keeping legacy defaults containing pipes intact. Order is
 * insensitive: `|tomorrow|optional` === `|optional|tomorrow`.
 */
export function parseVDateOptions(
	rawOptions: string | undefined | null,
): ParsedVDateOptions {
	if (!rawOptions) return { optional: false };

	const { remaining, found: bareOptional } = extractBareFlagPart(
		splitPipeParts(rawOptions),
		"optional",
	);

	let explicitOptional: boolean | undefined;
	const rest: string[] = [];

	for (const part of remaining) {
		const keyed = parsePipeKeyValue(part.trim());
		if (keyed?.key === "optional") {
			explicitOptional = parseBooleanFlag(keyed.value);
			continue;
		}

		rest.push(part);
	}

	const defaultValue = rest.join("|").trim() || undefined;
	return { defaultValue, optional: explicitOptional ?? bareOptional };
}
