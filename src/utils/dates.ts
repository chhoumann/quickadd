import { NLDParser } from "../parsers/NLDParser";

export function getNaturalLanguageDates() {
	return NLDParser;
}

export function getDate(input?: { format?: string; offset?: number; }) {
	let duration;

	if (
		input?.offset !== null &&
		input?.offset !== undefined &&
		typeof input.offset === "number"
	) {
		duration = window.moment.duration(input.offset, "days");
	}

	return input?.format
		? window.moment().add(duration).format(input.format)
		: window.moment().add(duration).format("YYYY-MM-DD");
}
