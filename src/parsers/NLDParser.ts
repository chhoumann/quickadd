import * as chrono from "chrono-node";
import type { IDateParser, ParsedMoment } from "./IDateParser";

/**
 * Words that pin a phrase to the past: "last friday", "friday last week",
 * "past monday", "previous thursday". chrono's `forwardDate` refiner pushes
 * every weekday-only result that lands before the reference date a week
 * forward, which turns "last thursday" into the *upcoming* Thursday. Phrases
 * that name the past explicitly are parsed without the forward preference;
 * everything else keeps it so bare weekdays ("friday") and bare month-days
 * ("march 5") still resolve to the next occurrence. "past" only counts when
 * it qualifies a day or period, so "friday at half past 3" stays forward.
 */
const EXPLICIT_PAST_PATTERN =
	/\b(?:last|previous)\b|\bpast\s+(?:few\s+)?(?:\w*day|weekend|week|month|year|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\b/i;

/** chrono's English grammar understands "last"/"past" but not "previous". */
const PREVIOUS_PATTERN = /\bprevious\b/gi;

export function prefersForwardDate(input: string): boolean {
	return !EXPLICIT_PAST_PATTERN.test(input);
}

class NLDParserImpl implements IDateParser {
	getParsedDate(input: string, reference: Date = new Date()): Date | null {
		const normalized = input.replace(PREVIOUS_PATTERN, "last");
		return chrono.parseDate(normalized, reference, {
			forwardDate: prefersForwardDate(normalized),
		});
	}

	/** Parse date using chrono-node natural language date parser */
	parseDate(input?: string): ParsedMoment | null {
		if (!input || !input.trim()) return null;

		try {
			const date = this.getParsedDate(input);
			if (!date) return null;

			// Check if moment is available at runtime
			if (!window.moment) {
				console.warn("Moment.js is not available");
				return null;
			}

			const moment = window.moment(date);
			return { moment };
		} catch (error) {
			console.warn("Failed to parse date:", input, error);
			return null;
		}
	}
}

// Export singleton instance to match expected API
export const NLDParser = new NLDParserImpl();
