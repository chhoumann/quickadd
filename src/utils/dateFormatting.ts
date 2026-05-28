import momentJalaali from "moment-jalaali";
import type { DateCalendar } from "./dateFormatSyntax";

export function formatDateValue(input: {
	date?: string | Date;
	format?: string;
	offset?: number;
	calendar?: DateCalendar;
}): string {
	const format = input.format?.trim() || "YYYY-MM-DD";
	const calendar = input.calendar ?? "gregorian";
	const formatter = calendar === "jalali" ? momentJalaali : window.moment;
	const base = input.date ? formatter(input.date) : formatter();

	if (input.offset !== undefined) {
		base.add(formatter.duration(input.offset, "days"));
	}

	return base.format(format);
}

function formatISODateValue(input: {
	isoString: string;
	format: string;
	calendar: DateCalendar;
}): string | null {
	try {
		const moment =
			input.calendar === "jalali"
				? momentJalaali(input.isoString)
				: window.moment(input.isoString);

		if (moment && moment.isValid()) {
			return moment.format(input.format);
		}
	} catch {
		// Invalid date or unavailable formatter.
	}

	return null;
}

export function formatISODate(
	isoString: string,
	format: string,
	calendar: DateCalendar = "gregorian",
): string | null {
	return formatISODateValue({ isoString, format, calendar });
}

export function parseDateInputValue(input: {
	value: string;
	format?: string;
	calendar: DateCalendar;
}): { isoString: string; formatted: string } | null {
	const value = input.value.trim();
	if (!value || input.calendar !== "jalali" || !input.format) return null;

	try {
		const parsed = momentJalaali(value, input.format, true);
		if (!parsed.isValid()) return null;

		const isoString = parsed.toISOString();
		const formatted =
			formatISODateValue({
				isoString,
				format: input.format,
				calendar: input.calendar,
			}) ?? parsed.format(input.format);

		return { isoString, formatted };
	} catch {
		return null;
	}
}
