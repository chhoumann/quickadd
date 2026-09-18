import { DATE_REGEX, DATE_REGEX_FORMATTED, TIME_REGEX, TIME_REGEX_FORMATTED, DATE_VARIABLE_REGEX, NUMBER_REGEX } from "../../constants";
import { getDate } from "../../utilityObsidian";
import type { RunClocks } from "../../types/dateOrigin";
import type { IDateParser } from "../../parsers/IDateParser";
import type { PromptContext } from "../formatter";
import { settingsStore } from "../../settingsStore";
import { normalizeDateInput } from "../../utils/dateAliases";
import { applyDateSnap, type DateSnap, parseDateSnapSegment } from "../../utils/dateModifiers";
import { parseVDateOptions } from "../../utils/vdateSyntax";
import { formatUnknownValue } from "../../utils/conditionalHelpers";

type ApplyCase = (value: string, style: string | undefined, token: string) => string;
interface DateTokenContext {
	clocks: () => RunClocks | undefined;
	applyCase: ApplyCase;
}
interface DateVariableContext {
	variables: Map<string, unknown>;
	dateParser: IDateParser | undefined;
	prompt: (name: string, context: PromptContext) => Promise<string>;
	applyCase: ApplyCase;
}
function replaceLiteral(input: string, pattern: RegExp, value: string): string {
	return input.replace(pattern, () => value);
}

export function defaultDateVariableFormat(withTime: boolean): string {
	return withTime ? "YYYY-MM-DD HH:mm" : "YYYY-MM-DD";
}

export function renderStoredDateVariable(
	stored: unknown,
	dateFormat: string,
	snap: DateSnap | undefined,
	dateParser: IDateParser | undefined,
): { text: string; normalized?: string } | null {
	if (stored === undefined) return null;

	let value = stored;
	let normalized: string | undefined;

	// A VDATE variable pre-seeded as a plain string (via the JS API, a URI
	// parameter, or a `quickadd:run value-x=` flag) is coerced into the internal
	// @date:ISO form so formatting works. Only when it parses: an unparseable
	// string keeps the verbatim branch below, for back-compat.
	if (typeof value === "string" && value && !value.startsWith("@date:")) {
	if (dateParser) {
		const aliasMap = settingsStore.getState().dateAliases;
		const parseAttempt = dateParser.parseDate(
			normalizeDateInput(value, aliasMap),
		);
		if (parseAttempt) {
			normalized = `@date:${parseAttempt.moment.toISOString()}`;
			value = normalized;
		}
	}
	} else if (value instanceof Date) {
	// Some callers pass actual Date objects through the JS API.
	if (!Number.isNaN(value.getTime())) {
		normalized = `@date:${value.toISOString()}`;
		value = normalized;
	}
}

	if (typeof value === "string" && value.startsWith("@date:")) {
		const isoString = value.substring(6);
		if (dateParser && window.moment) {
			const moment = window.moment(isoString);
			if (moment?.isValid()) {
				// Snap is per-occurrence (issue #511): the stored @date:ISO stays
				// raw, so {{VDATE:d,F1|startof:week}} and {{VDATE:d,F2}} share one
				// picked date but only one snaps. A fresh moment per call prevents
				// leaks.
				return { text: applyDateSnap(moment, snap).format(dateFormat), ...(normalized !== undefined ? { normalized } : {}) };
			}
		}
		return { text: "", ...(normalized !== undefined ? { normalized } : {}) };
	}
	if (typeof value === "string" && value) {
		// Backward compatibility: use the stored value as-is.
		return { text: value };
	}
	if (value != null) {
		// Avoid throwing if a non-string value is stored.
		return { text: formatUnknownValue(value) };
	}
	// null, or "" - answered-empty.
	return { text: "" };
}

export function replaceDateInString(input: string, context: DateTokenContext): string {
	let output = input;
	for (const pattern of [DATE_REGEX, DATE_REGEX_FORMATTED]) {
	const formatted = pattern === DATE_REGEX_FORMATTED;
	while (pattern.test(output)) {
		const match = pattern.exec(output);
		if (formatted && !match) throw invalidDateToken("date", output, pattern);
		const offsetText = match?.[formatted ? 2 : 1]?.replace("+", "").trim();
		const offset = offsetText && NUMBER_REGEX.test(offsetText) ? parseInt(offsetText) : undefined;
		const snapText = match?.[formatted ? 3 : 2];
		const clocks = context.clocks();
		const rendered = getDate({
			...(formatted ? { format: match?.[1] } : {}),
			offset,
			snap: snapText ? parseDateSnapSegment(snapText) ?? undefined : undefined,
			origin: clocks?.date,
			now: clocks?.now,
		});
		output = replaceLiteral(output, pattern, context.applyCase(
			rendered, match?.[formatted ? 4 : 3], match?.[0] ?? "{{DATE}}",
		));
	}
}
	return output;
}

export function replaceTimeInString(input: string, context: DateTokenContext): string {
	let output = input;
	for (const pattern of [TIME_REGEX, TIME_REGEX_FORMATTED]) {
	const formatted = pattern === TIME_REGEX_FORMATTED;
	while (pattern.test(output)) {
		const match = pattern.exec(output);
		if (!match) throw invalidDateToken("time", output, pattern);
		const rendered = getDate({
			format: formatted ? match[1] : "HH:mm",
			now: context.clocks()?.now,
		});
		output = replaceLiteral(output, pattern, context.applyCase(
			rendered, match[formatted ? 2 : 1], match[0],
		));
	}
}
	return output;
}

function invalidDateToken(kind: string, input: string, pattern: RegExp): Error {
	const position = input.search(pattern);
	return new Error(`Unable to parse ${kind} format. Invalid syntax in: "${input.substring(Math.max(0, position - 10), Math.min(input.length, position + 30))}..."`);
}

export async function replaceDateVariableInString(input: string, context: DateVariableContext): Promise<string> {
	// Scan with a GLOBAL regex + accumulator (mirrors replaceFieldVarInString)
	// so a malformed/empty-name {{VDATE:}} token is skipped (left literal) and
	// every LATER valid {{VDATE}} is still prompted. The previous in-place
	// while-loop `break`ed the entire scan on the first empty-name match, which
	// silently dropped all subsequent date prompts. The accumulator also never
	// re-scans a replacement, so a stored value re-containing the token can't
	// loop.
	const regex = new RegExp(DATE_VARIABLE_REGEX.source, "gi");
	let output = "";
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = regex.exec(input)) !== null) {
		output += input.slice(lastIndex, match.index);
		lastIndex = match.index + match[0].length;

		const variableName = match[1]?.trim();
		// Empty/incomplete token (e.g. {{VDATE:}} or {{VDATE:,YYYY}}): leave it
		// literal and keep scanning so a later valid token still resolves.
		if (!variableName) {
			output += match[0];
			continue;
		}

		const { defaultValue, optional, withTime, snap, caseStyle } =
			parseVDateOptions(match[3]);
		// A |time/|datetime token with no explicit format gets a datetime
		// default so the rendered value carries the picked time.
		const dateFormat =
			match[2]?.trim() || defaultDateVariableFormat(withTime);

		const existingValue = context.variables.get(variableName);

		// Check if we already have this date variable stored.
		// Only `undefined` counts as unset — null and "" are intentional
		// values (same contract as VALUE variables, see #872), so a
		// script-set "" renders empty instead of re-prompting.
		if (existingValue === undefined) {
			// Prompt for date input with VDATE context
			const dateInput = await context.prompt(
				variableName,
				{ type: "VDATE", dateFormat, defaultValue, optional, withTime }
			);
			if (optional && !dateInput?.trim()) {
				// Optional date left blank or skipped: answered-empty.
				context.variables.set(variableName, "");
			} else if (dateInput?.startsWith("@date:")) {
				context.variables.set(variableName, dateInput);
			} else {
				if (!context.dateParser)
					throw new Error("Date parser is not available");

				const aliasMap = settingsStore.getState().dateAliases;
				const normalizedInput = normalizeDateInput(
					dateInput,
					aliasMap,
				);
				const parseAttempt = context.dateParser.parseDate(normalizedInput);

				if (parseAttempt) {
					// Store the ISO string with a special prefix
					context.variables.set(
						variableName,
						`@date:${parseAttempt.moment.toISOString()}`,
					);
				} else {
					throw new Error(
						`unable to parse date variable ${dateInput}${
							optional
								? ""
								: ". Tip: add |optional inside the {{VDATE}} token to allow leaving this date empty"
						}`,
					);
				}
			}
		}

		// Format the date based on what's stored. Shared with both preview
		// formatters, which resolve an ANSWERED {{VDATE:}} through the same
		// helper so the one-page form's preview shows the date the user just
		// picked rather than today's (#1589).
		const rendered = renderStoredDateVariable(
			context.variables.get(variableName),
			dateFormat,
			snap,
			context.dateParser,
		);
		if (rendered?.normalized !== undefined) {
			context.variables.set(variableName, rendered.normalized);
		}

		output += context.applyCase(
			rendered?.text ?? "",
			caseStyle,
			match[0],
		);
	}

	return output + input.slice(lastIndex);
}
