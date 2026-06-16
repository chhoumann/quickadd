import { applyDateSnap, type DateSnap } from "./dateModifiers";

export function getDate(input?: {
	format?: string;
	offset?: number;
	snap?: DateSnap;
}) {
	let duration;

	if (
		input?.offset !== null &&
		input?.offset !== undefined &&
		typeof input.offset === "number"
	) {
		duration = window.moment.duration(input.offset, "days");
	}

	// Order: base instant -> +N days offset -> snap to period boundary -> format.
	const moment = applyDateSnap(window.moment().add(duration), input?.snap);

	return moment.format(input?.format ?? "YYYY-MM-DD");
}
