import { NLDParser } from "../parsers/NLDParser";
import type { IDateParser } from "../parsers/IDateParser";
import { settingsStore } from "../settingsStore";
import type { DateAliasMap } from "./dateAliases";
import { normalizeDateInput } from "./dateAliases";
import type { DateCalendar } from "./dateFormatSyntax";
import { formatISODateValue, parseDateInputValue } from "./dateFormatting";

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
	dateParser: IDateParser = NLDParser,
	aliases?: DateAliasMap,
	calendar: DateCalendar = "gregorian",
): ParsedDate {
	if (!input || !input.trim()) {
		return {
			isValid: false,
			error: "Empty input"
		};
	}

	try {
		const parsedInput = parseDateInputValue({
			value: input,
			format,
			calendar,
		});

		if (parsedInput) {
			return {
				isValid: true,
				isoString: parsedInput.isoString,
				formatted: parsedInput.formatted,
			};
		}

		const aliasMap = aliases ?? settingsStore.getState().dateAliases;
		const normalizedInput = normalizeDateInput(input, aliasMap);
		const parseResult = dateParser.parseDate(normalizedInput);

		if (parseResult?.moment?.isValid()) {
			const isoString = parseResult.moment.toISOString();
			const outputFormat = format || "YYYY-MM-DD";
			const formatted =
				formatISODateValue({
					isoString,
					format: outputFormat,
					calendar,
				}) ?? parseResult.moment.format(outputFormat);

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
export function formatISODate(
	isoString: string,
	format: string,
	calendar: DateCalendar = "gregorian",
): string | null {
	return formatISODateValue({ isoString, format, calendar });
}
