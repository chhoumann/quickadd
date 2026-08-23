import {
	extractBareFlagPart,
	parseBooleanFlag,
	parsePipeKeyValue,
	splitPipeParts,
} from "./pipeSyntax";
import { type DateSnap, normalizeDateUnit } from "./dateModifiers";

export type ParsedVDateOptions = {
	defaultValue?: string;
	optional: boolean;
	/** Token requested a date AND time picker via |time / |datetime / |type:datetime. */
	withTime: boolean;
	/** Snap the resolved date to a period boundary via |startof:/|endof: (issue #511). */
	snap?: DateSnap;
	/** Apply the shared per-token case transform after formatting the date. */
	caseStyle?: string;
};

/**
 * Parses the post-pipe segment of a {{VDATE:name,format|...}} token.
 *
 * DATE_VARIABLE_REGEX's third capture group swallows everything after the
 * first pipe, so the segment may itself contain pipes. Parts that spell the
 * `optional` flag (bare or keyed `optional:<bool>`) are extracted; the
 * remaining parts are re-joined verbatim to form the natural-language
 * default, keeping legacy defaults containing pipes intact. Order is
 * insensitive: `|tomorrow|optional` === `|optional|tomorrow`.
 */
export function parseVDateOptions(
	rawOptions: string | undefined | null,
): ParsedVDateOptions {
	if (!rawOptions) return { optional: false, withTime: false };

	// Pull the bare control flags out before re-joining the rest as the default,
	// so a legacy pipe-containing natural-language default still survives. Order
	// is insensitive (same approach as |optional). A literal default of exactly
	// "time"/"datetime" needs the |default-style escape — vanishingly rare.
	const { remaining: afterOptional, found: bareOptional } = extractBareFlagPart(
		splitPipeParts(rawOptions),
		"optional",
	);
	const { remaining: afterTime, found: bareTime } = extractBareFlagPart(
		afterOptional,
		"time",
	);
	const { remaining, found: bareDatetime } = extractBareFlagPart(
		afterTime,
		"datetime",
	);

	let explicitOptional: boolean | undefined;
	let keyedDatetime = false;
	let snap: DateSnap | undefined;
	let caseStyle: string | undefined;
	const rest: string[] = [];

	for (const part of remaining) {
		const keyed = parsePipeKeyValue(part.trim());
		if (keyed?.key === "optional") {
			explicitOptional = parseBooleanFlag(keyed.value);
			continue;
		}
		if (keyed?.key === "type") {
			// |type:datetime enables the time picker; any keyed |type:... is a
			// control flag, never part of the natural-language default.
			if (keyed.value.trim().toLowerCase() === "datetime") keyedDatetime = true;
			continue;
		}
		if (keyed?.key === "startof" || keyed?.key === "endof") {
			// |startof:<unit> / |endof:<unit> snap the resolved date (issue #511).
			// First wins; a bad unit throws. Never part of the default value.
			if (!snap) {
				snap = {
					boundary: keyed.key === "startof" ? "start" : "end",
					unit: normalizeDateUnit(keyed.value),
				};
			}
			continue;
		}
		if (keyed?.key === "case") {
			caseStyle = keyed.value.trim() || undefined;
			continue;
		}

		rest.push(part);
	}

	const defaultValue = rest.join("|").trim() || undefined;
	return {
		defaultValue,
		optional: explicitOptional ?? bareOptional,
		withTime: bareTime || bareDatetime || keyedDatetime,
		snap,
		...(caseStyle ? { caseStyle } : {}),
	};
}

/**
 * {@link parseVDateOptions} for a PREVIEW, which evaluates INCOMPLETE input on
 * every keystroke.
 *
 * `|startof:<unit>` throws out of `normalizeDateUnit` for a unit that does not
 * resolve, and half of a unit usually does not (`we`, `mont`) - so in the run
 * that throw is the right answer, and in a preview it would blank the row
 * between two keystrokes, which is the noise #1558 removed. Note that some
 * short forms ARE valid aliases (`w`, `d`, `M`), so "unfinished" is not a
 * property of the string.
 *
 * The two channels are therefore split. The OPTIONS come back usable either
 * way, so the preview TEXT stays stable while you type; the ERROR comes back
 * separately for the caller to put on the diagnostics channel, which the
 * builder holds back until the field has been still for 500ms
 * (`DIAGNOSTICS_IDLE_MS`). Swallowing it outright would have deleted a
 * diagnostic the body preview already shipped - and left a format the run
 * cannot execute previewing as a finished date.
 */
export function parseVDateOptionsForPreview(rawOptions: string | undefined | null): {
	options: ParsedVDateOptions;
	error?: string;
} {
	try {
		return { options: parseVDateOptions(rawOptions) };
	} catch (error) {
		return {
			options: { optional: false, withTime: false },
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
