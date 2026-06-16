import type { Moment, unitOfTime } from "moment";
import { parsePipeKeyValue } from "./pipeSyntax";

/**
 * Shared "snap a date to the start/end of a period" support for {{DATE}} and
 * {{VDATE}} tokens (issue #511). A snap moves an instant to the boundary of the
 * period it belongs to, so e.g. `{{DATE:gggg.MM.[Wk]w|startof:week}}` renders
 * the MONTH of the week's first day instead of today's calendar month.
 *
 * The locale-vs-ISO week distinction is an explicit unit choice — `week` uses
 * the locale's first day of week (matching the `w`/`gggg` tokens), `isoweek`
 * uses Monday (matching `W`/`GGGG`) — so there is no implicit anchor guessing.
 */

export type DateSnapBoundary = "start" | "end";

export interface DateSnap {
	boundary: DateSnapBoundary;
	/** Canonical moment unit, e.g. "week", "isoWeek", "month". */
	unit: unitOfTime.StartOf;
}

// Lower-cased user input -> canonical moment unit. Plural/short aliases are
// accepted for ergonomics; everything else throws so a typo can never silently
// no-op (moment's startOf returns the date unchanged on an unknown unit).
const UNIT_ALIASES: Record<string, unitOfTime.StartOf> = {
	year: "year",
	years: "year",
	y: "year",
	quarter: "quarter",
	quarters: "quarter",
	q: "quarter",
	month: "month",
	months: "month",
	week: "week",
	weeks: "week",
	w: "week",
	isoweek: "isoWeek",
	isoweeks: "isoWeek",
	day: "day",
	days: "day",
	d: "day",
};

/** Human-facing list of the documented units, used in error messages. */
export const VALID_DATE_SNAP_UNITS = "year, quarter, month, week, isoweek, day";

/**
 * Normalises a user-supplied unit to moment's canonical form, throwing a
 * self-correcting error on anything unrecognised.
 */
export function normalizeDateUnit(raw: string): unitOfTime.StartOf {
	const key = raw.trim().toLowerCase();
	const unit = UNIT_ALIASES[key];
	if (!unit) {
		throw new Error(
			`Unknown date unit "${raw.trim()}". Valid units: ${VALID_DATE_SNAP_UNITS}.`,
		);
	}
	return unit;
}

/**
 * Parses a single pipe segment (already stripped of its leading `|`), e.g.
 * "startof:week". Returns the snap for a `startof:`/`endof:` segment, or `null`
 * when the segment is not a snap option (so callers can treat it as something
 * else — a literal for {{DATE}}, a default value for {{VDATE}}). Throws when the
 * key IS a snap key but the unit is unknown.
 */
export function parseDateSnapSegment(segment: string): DateSnap | null {
	const keyed = parsePipeKeyValue(segment);
	if (!keyed) return null;
	if (keyed.key === "startof")
		return { boundary: "start", unit: normalizeDateUnit(keyed.value) };
	if (keyed.key === "endof")
		return { boundary: "end", unit: normalizeDateUnit(keyed.value) };
	return null;
}

/**
 * Applies a snap to a moment IN PLACE (moment mutates) and returns it. Callers
 * pass a fresh/cloned instance. `start` -> startOf (00:00:00.000), `end` ->
 * endOf (23:59:59.999).
 */
export function applyDateSnap(moment: Moment, snap: DateSnap | undefined): Moment {
	if (!snap) return moment;
	return snap.boundary === "start"
		? moment.startOf(snap.unit)
		: moment.endOf(snap.unit);
}
