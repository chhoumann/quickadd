import { log } from "../logger/logManager";
import { parsePipeKeyValue, splitPipeParts } from "./pipeSyntax";

export type DateCalendar = "gregorian" | "jalali";

// "default" renders Latin digits and English/transliterated names (current
// behavior); "fa" renders Persian digits and Persian month/weekday names.
export type DateLocale = "default" | "fa";

export type ParsedDateFormatToken = {
	format: string;
	calendar: DateCalendar;
	locale: DateLocale;
	offset?: number;
};

export type ParsedDateVariableToken = {
	variableName: string;
	format: string;
	calendar: DateCalendar;
	locale: DateLocale;
	defaultValue?: string;
};

const DEFAULT_DATE_FORMAT = "YYYY-MM-DD";
const DATE_OPTION_KEYS = new Set(["calendar", "locale"]);
const DATE_VARIABLE_OPTION_KEYS = new Set(["calendar", "default", "locale"]);
const DATE_OFFSET_SUFFIX_REGEX = /(\+-?\d+)$/;

function normalizeCalendar(value: string | undefined): DateCalendar {
	const normalized = value?.trim().toLowerCase();

	switch (normalized) {
		case "jalali":
		case "jalaali":
		case "persian":
			return "jalali";
		case "gregorian":
		case "gregory":
		case undefined:
		case "":
			return "gregorian";
		default:
			log.logWarning(
				`QuickAdd: Unsupported date calendar "${value}". Falling back to gregorian.`,
			);
			return "gregorian";
	}
}

function normalizeLocale(value: string | undefined): DateLocale {
	const normalized = value?.trim().toLowerCase();

	switch (normalized) {
		case "fa":
		case "fa-ir":
		case "farsi":
		case "persian":
			return "fa";
		case "default":
		case "system":
		case "en":
		case "latin":
		case undefined:
		case "":
			return "default";
		default:
			log.logWarning(
				`QuickAdd: Unsupported date locale "${value}". Falling back to default.`,
			);
			return "default";
	}
}

function extractOffset(format: string): { format: string; offset?: number } {
	const match = DATE_OFFSET_SUFFIX_REGEX.exec(format);
	if (!match) return { format };

	const offset = Number.parseInt(match[1].replace("+", ""), 10);
	if (Number.isNaN(offset)) return { format };

	return {
		format: format.slice(0, -match[1].length),
		offset,
	};
}

function isRecognizedOption(part: string, optionKeys: Set<string>): boolean {
	const parsed = parsePipeKeyValue(part.trim());
	return parsed ? optionKeys.has(parsed.key) : false;
}

export function parseDateFormatToken(
	raw: string | undefined,
): ParsedDateFormatToken {
	const parts = splitPipeParts(raw ?? "");
	const formatAndOffset = (parts.shift() ?? "").trim();
	const unknownOptionParts: string[] = [];
	let calendar: DateCalendar = "gregorian";
	let locale: DateLocale = "default";

	for (const part of parts) {
		const trimmed = part.trim();
		if (!trimmed) continue;

		const parsed = parsePipeKeyValue(trimmed);
		if (!parsed || !DATE_OPTION_KEYS.has(parsed.key)) {
			unknownOptionParts.push(part);
			continue;
		}

		switch (parsed.key) {
			case "calendar":
				calendar = normalizeCalendar(parsed.value);
				break;
			case "locale":
				locale = normalizeLocale(parsed.value);
				break;
		}
	}

	const formatWithUnknownPipes = [formatAndOffset, ...unknownOptionParts]
		.filter((part) => part.length > 0)
		.join("|");
	const { format, offset } = extractOffset(
		formatWithUnknownPipes || DEFAULT_DATE_FORMAT,
	);

	return {
		format: format || DEFAULT_DATE_FORMAT,
		calendar,
		locale,
		offset,
	};
}

export function parseDateVariableToken(input: {
	variableName: string;
	dateFormat?: string;
	rawOptions?: string;
}): ParsedDateVariableToken {
	const variableName = input.variableName.trim();
	const format = input.dateFormat?.trim() || DEFAULT_DATE_FORMAT;
	const rawOptions = input.rawOptions ?? "";
	const optionParts = splitPipeParts(rawOptions)
		.map((part) => part.trim())
		.filter(Boolean);
	const usesOptions = optionParts.some((part) =>
		isRecognizedOption(part, DATE_VARIABLE_OPTION_KEYS),
	);

	let calendar: DateCalendar = "gregorian";
	let locale: DateLocale = "default";
	let defaultValue: string | undefined;

	if (!usesOptions) {
		defaultValue = rawOptions.trim() || undefined;
	} else {
		for (const part of optionParts) {
			const parsed = parsePipeKeyValue(part);
			if (!parsed || !DATE_VARIABLE_OPTION_KEYS.has(parsed.key)) continue;

			switch (parsed.key) {
				case "calendar":
					calendar = normalizeCalendar(parsed.value);
					break;
				case "locale":
					locale = normalizeLocale(parsed.value);
					break;
				case "default":
					defaultValue = parsed.value || undefined;
					break;
			}
		}
	}

	return {
		variableName,
		format,
		calendar,
		locale,
		defaultValue,
	};
}
