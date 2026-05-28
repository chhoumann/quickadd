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

export type ParseNaturalLanguageDateOptions = {
	format?: string;
	dateParser?: IDateParser;
	aliases?: DateAliasMap;
	calendar?: DateCalendar;
};

export type CoerceDateVariableOptions = ParseNaturalLanguageDateOptions;

/**
 * Parse a natural language date string using built-in chrono-node parser
 * @param input - The date string to parse
 * @param options - Optional parser, alias, calendar, and output format settings
 * @returns ParsedDate object with the result
 */
export function parseNaturalLanguageDate(
	input: string,
	options: ParseNaturalLanguageDateOptions = {},
): ParsedDate {
	const {
		format,
		dateParser = NLDParser,
		aliases,
		calendar = "gregorian",
	} = options;

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

export function coerceToDateVariable(
	value: unknown,
	options: CoerceDateVariableOptions = {},
): string | null {
	if (typeof value === "string") {
		if (value.startsWith("@date:")) return value;
		if (!value.trim()) return null;

		const parsed = parseNaturalLanguageDate(value, options);
		return parsed.isValid && parsed.isoString
			? `@date:${parsed.isoString}`
			: null;
	}

	if (value instanceof Date && !Number.isNaN(value.getTime())) {
		return `@date:${value.toISOString()}`;
	}

	return null;
}

/**
 * Format an ISO date string using the same calendar-aware formatter used by
 * natural-language date parsing.
 *
 * Keep this facade as the call-site API for date parser consumers; lower-level
 * formatter helpers stay internal to the date utility modules.
 */
export function formatISODate(
	isoString: string,
	format: string,
	calendar: DateCalendar = "gregorian",
): string | null {
	return formatISODateValue({ isoString, format, calendar });
}
