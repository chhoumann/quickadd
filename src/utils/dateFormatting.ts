import momentJalaali from "moment-jalaali";
import type { DateCalendar, DateLocale } from "./dateFormatSyntax";

let persianLocaleLoaded = false;

// Defines moment-jalaali's "fa" locale (Persian digits + month/weekday names)
// on first use. loadPersian also flips the global locale to "fa", so we restore
// whatever the prior default was — only an explicit per-call .locale("fa")
// should render Persian, keeping the default jalali path unchanged. We capture
// and restore the previous locale rather than assuming "en": moment-jalaali
// uses its own bundled moment instance (separate from Obsidian's window.moment),
// so its default is moment core's "en" today, but we avoid hardcoding it.
function ensurePersianLocale(): void {
	if (persianLocaleLoaded) return;
	const previousLocale = momentJalaali.locale();
	momentJalaali.loadPersian({
		usePersianDigits: true,
		dialect: "persian-modern",
	});
	momentJalaali.locale(previousLocale);
	persianLocaleLoaded = true;
}

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

// Normalize Persian digits to Latin so input parsing is locale-agnostic and the
// strict round-trip check compares Latin against Latin.
function toLatinDigits(value: string): string {
	return value.replace(/[۰-۹]/g, (digit) =>
		String(PERSIAN_DIGITS.indexOf(digit)),
	);
}

export function formatDateValue(input: {
	date?: string | Date;
	format?: string;
	offset?: number;
	calendar?: DateCalendar;
	locale?: DateLocale;
}): string {
	const format = input.format?.trim() || "YYYY-MM-DD";
	const calendar = input.calendar ?? "gregorian";
	const formatter = calendar === "jalali" ? momentJalaali : window.moment;
	const base = input.date ? formatter(input.date) : formatter();

	if (calendar === "jalali" && input.locale === "fa") {
		ensurePersianLocale();
		base.locale("fa");
	}

	if (input.offset !== undefined) {
		base.add(formatter.duration(input.offset, "days"));
	}

	return base.format(format);
}

function formatISODateValue(input: {
	isoString: string;
	format: string;
	calendar: DateCalendar;
	locale?: DateLocale;
}): string | null {
	try {
		const moment =
			input.calendar === "jalali"
				? momentJalaali(input.isoString)
				: window.moment(input.isoString);

		if (input.calendar === "jalali" && input.locale === "fa") {
			ensurePersianLocale();
			moment.locale("fa");
		}

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
	locale: DateLocale = "default",
): string | null {
	return formatISODateValue({ isoString, format, calendar, locale });
}

export function parseDateInputValue(input: {
	value: string;
	format?: string;
	calendar: DateCalendar;
	locale?: DateLocale;
}): { isoString: string; formatted: string } | null {
	const value = toLatinDigits(input.value.trim());
	if (!value || input.calendar !== "jalali" || !input.format) return null;

	const locale = input.locale ?? "default";

	try {
		const parsed = momentJalaali(value, input.format, true);
		if (!parsed.isValid()) return null;

		const isoString = parsed.toISOString();
		const formatted =
			formatISODateValue({
				isoString,
				format: input.format,
				calendar: input.calendar,
				locale,
			}) ?? parsed.format(input.format);

		return { isoString, formatted };
	} catch {
		return null;
	}
}
