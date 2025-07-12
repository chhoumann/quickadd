import type { App } from "obsidian";
import { getNaturalLanguageDates } from "../utilityObsidian";

export interface ParsedDate {
	isValid: boolean;
	isoString?: string;
	formatted?: string;
	error?: string;
}

/**
 * Parse a natural language date string using the Natural Language Dates plugin
 * @param app - The Obsidian app instance
 * @param input - The date string to parse
 * @param format - Optional format string for the output (defaults to YYYY-MM-DD)
 * @returns ParsedDate object with the result
 */
export function parseNaturalLanguageDate(
	app: App,
	input: string,
	format?: string
): ParsedDate {
	if (!input || !input.trim()) {
		return {
			isValid: false,
			error: "Empty input"
		};
	}

	const nld = getNaturalLanguageDates(app);
	if (!nld || !nld.parseDate || typeof nld.parseDate !== "function") {
		return {
			isValid: false,
			error: "Natural Language Dates plugin is not installed or enabled"
		};
	}

	try {
		const parseResult = (
			nld.parseDate as (s: string) => {
				moment?: {
					format: (s: string) => string;
					toISOString: () => string;
					isValid: () => boolean;
				};
			}
		)(input);

		if (parseResult && parseResult.moment && parseResult.moment.isValid()) {
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