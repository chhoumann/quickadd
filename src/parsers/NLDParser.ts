import * as chrono from "chrono-node";
import type { IDateParser, ParsedMoment } from "./IDateParser";
import { log } from "../logger/logManager";

/**
 * chrono's `forwardDate` pushes a weekday result that lands before the
 * reference date a week forward, turning "last thursday" into the upcoming one.
 * Phrases that name the past are parsed without it. "past" counts only when it
 * qualifies a day or period, so "half past 3" stays forward.
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

	parseDate(input?: string): ParsedMoment | null {
		if (!input || !input.trim()) return null;

		try {
			const date = this.getParsedDate(input);
			if (!date) return null;

			if (!window.moment) {
				log.logWarning("Moment.js is not available");
				return null;
			}

			const moment = window.moment(date);
			return { moment };
		} catch (error) {
			log.logWarning(`Failed to parse date "${input}": ${String(error)}`);
			return null;
		}
	}
}

export const NLDParser = new NLDParserImpl();
