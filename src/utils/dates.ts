import { applyDateSnap, type DateSnap } from "./dateModifiers";

export interface GetDateInput {
	format?: string;
	offset?: number;
	snap?: DateSnap;
	/** Calendar-day origin. Time-of-day comes from `now` unless a snap moves it. */
	origin?: Date;
	/** Wall clock. Defaults to the live instant. TIME tokens pass this and omit origin. */
	now?: Date;
}

function wallClock(now?: Date) {
	return now === undefined ? window.moment() : window.moment(now);
}

function instantForDate(input?: GetDateInput) {
	const wall = wallClock(input?.now);
	if (!input?.origin) return wall;

	return window
		.moment(input.origin)
		.hour(wall.hour())
		.minute(wall.minute())
		.second(wall.second())
		.millisecond(wall.millisecond());
}

export function getDate(input?: GetDateInput) {
	let duration;

	if (
		input?.offset !== null &&
		input?.offset !== undefined &&
		typeof input.offset === "number"
	) {
		duration = window.moment.duration(input.offset, "days");
	}

	const moment = applyDateSnap(instantForDate(input).add(duration), input?.snap);

	return moment.format(input?.format ?? "YYYY-MM-DD");
}
