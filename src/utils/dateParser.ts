import { NLDParser } from "../parsers/NLDParser";
import type { IDateParser } from "../parsers/IDateParser";
import { settingsStore } from "../settingsStore";
import type { DateAliasMap } from "./dateAliases";
import { normalizeDateInput } from "./dateAliases";

interface ParsedDate {
	isValid: boolean;
	isoString?: string;
	formatted?: string;
	error?: string;
}

/** Parses a natural-language date with chrono; `format` defaults to YYYY-MM-DD. */
export function parseNaturalLanguageDate(
	input: string,
	format?: string,
	dateParser: IDateParser = NLDParser,
	aliases?: DateAliasMap,
): ParsedDate {
	if (!input || !input.trim()) {
		return {
			isValid: false,
			error: "Empty input"
		};
	}

	try {
		const aliasMap = aliases ?? settingsStore.getState().dateAliases;
		const normalizedInput = normalizeDateInput(input, aliasMap);
		const parseResult = dateParser.parseDate(normalizedInput);

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

/** Formats an ISO date string with moment, or null if it is invalid. */
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
