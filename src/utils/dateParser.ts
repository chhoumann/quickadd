import { NLDParser } from "../parsers/NLDParser";
import type { IDateParser } from "../parsers/IDateParser";

export interface ParsedDate {
	isValid: boolean;
	isoString?: string;
	formatted?: string;
	error?: string;
}

/**
 * Parse a natural language date string using built-in chrono-node parser
 * @param input - The date string to parse
 * @param format - Optional format string for the output (defaults to YYYY-MM-DD)
 * @param dateParser - Optional date parser to use (defaults to NLDParser)
 * @returns ParsedDate object with the result
 */
export function parseNaturalLanguageDate(
	input: string,
	format?: string,
	dateParser: IDateParser = NLDParser
): ParsedDate {
	if (!input || !input.trim()) {
		return {
			isValid: false,
			error: "Empty input"
		};
	}

	try {
		const parseResult = dateParser.parseDate(input);

		if (parseResult?.moment?.isValid()) {
			const isoString = parseResult.moment.toISOString();
			const formatted = format
				? parseResult.moment.format(format)
				: parseResult.moment.format("YYYY-MM-DD");

			return {
				isValid: true,
				isoString,
				formatted
			};
		} else {
			return {
				isValid: false,
				error: "Unable to parse date"
			};
		}
	} catch (error) {
		return {
			isValid: false,
			error: `Parse error: ${error instanceof Error ? error.message : "Unknown error"}`
		};
	}
}

/**
 * Format an ISO date string using moment.js
 * @param isoString - The ISO date string to format
 * @param format - The desired output format
 * @returns The formatted date string or null if invalid
 */
export function formatISODate(isoString: string, format: string): string | null {
	if (!window.moment) {
		return null;
	}

	try {
		const moment = window.moment(isoString);
		if (moment.isValid()) {
			return moment.format(format);
		}
	} catch {
		// Invalid date - return null
	}

	return null;
}