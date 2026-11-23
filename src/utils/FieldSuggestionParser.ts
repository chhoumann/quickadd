import type { WarnSink } from "./warnSink";
import {
	parseBooleanFlag,
	parsePipeKeyValue,
	splitPipeParts,
} from "./pipeSyntax";
import { suggestSimilarKeys } from "./suggestSimilarKeys";
import { RESERVED_VALUE_NAMES } from "./valueSyntax";
import {
	parseMultiValueFormat,
	type MultiValueFormat,
} from "./multiValueFormat";

/**
 * Every filter key the `{{FIELD:...}}` grammar recognises, in warning order.
 * Authoritative: parse() checks membership before dispatching, so a switch case
 * without an entry here stops working rather than drifting from the warning.
 */
export const FIELD_FILTER_KEYS = [
	"folder",
	"tag",
	"inline",
	"inline-code-blocks",
	"exclude-folder",
	"exclude-tag",
	"exclude-file",
	"default",
	"default-from",
	"default-empty",
	"default-always",
	"case-sensitive",
	"multi",
	"format",
	"label",
	"name",
] as const;

/**
 * Wrong keys whose nearest neighbour is a worse answer than a sentence.
 *
 * `case-insensitive` is one edit family away from `case-sensitive`, so a plain
 * "did you mean" would tell someone who asked for insensitive matching to write
 * `case-sensitive:true` - silently inverting what they asked for. A negation is
 * not a typo, so it gets an explicit answer instead of a guess.
 */
const FIELD_FILTER_HINTS = new Map<string, string>([
	[
		"case-insensitive",
		'matching is already case-insensitive; use "case-sensitive:true" to match exactly',
	],
]);

/** Keeps one absurd key or one very long token from re-inflating the warning. */
function clampForMessage(value: string, max: number): string {
	return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function quoteList(values: string[]): string {
	const quoted = values.map((value) => `"${value}"`);
	if (quoted.length <= 1) return quoted.join("");
	return `${quoted.slice(0, -1).join(", ")} or ${quoted[quoted.length - 1]}`;
}

/**
 * Names the mistake instead of reciting the vocabulary. The fix comes before
 * the echoed token so the preview's three-line clamp never cuts it off.
 */
export function describeUnknownFieldFilter(
	filterKey: string,
	input: string,
): string {
	const key = clampForMessage(filterKey, 32);
	// The braces already delimit the token; wrapping it in quotes too left a
	// dangling `"` at a line break in the inline diagnostic.
	const token = `{{FIELD:${clampForMessage(input, 48)}}}`;

	// A Map, not an object literal: `filterKey` is whatever the user typed after a
	// pipe, and an object lookup would answer `constructor` or `__proto__` with a
	// member of Object.prototype - stringified into the warning as
	// "function Object() { [native code] }".
	const hint = FIELD_FILTER_HINTS.get(filterKey);
	if (hint) {
		return `Unknown FIELD filter "${key}" - ${hint}. Ignored in ${token}.`;
	}

	const suggestions = suggestSimilarKeys(filterKey, FIELD_FILTER_KEYS);
	if (suggestions.length > 0) {
		return `Unknown FIELD filter "${key}" - did you mean ${quoteList(suggestions)}? Ignored in ${token}.`;
	}

	return `Unknown FIELD filter "${key}" in ${token} was ignored. Supported filters: ${FIELD_FILTER_KEYS.join(", ")}.`;
}

/**
 * A recognised filter written without its value, e.g. `|folder`, which a live
 * preview sees for one keystroke. Not an unknown key, and not something the
 * typo suggester should answer.
 */
function describeValuelessFieldFilter(
	filterKey: string,
	input: string,
): string {
	const key = clampForMessage(filterKey, 32);
	return `FIELD filter "${key}" needs a value - write "${key}:value". Ignored in {{FIELD:${clampForMessage(input, 48)}}}.`;
}

export interface FieldFilter {
	/**
	 * Legacy single-folder include. Kept for compatibility with existing callers.
	 * New code should read both this and `folders`; repeated `folder:` filters
	 * populate `folders` and mean "any of these folders".
	 */
	folder?: string;
	folders?: string[];
	tags?: string[];
	inline?: boolean;
	inlineCodeBlocks?: string[];
	defaultValue?: string;
	defaultEmpty?: boolean;
	defaultAlways?: boolean;
	/**
	 * Source for a context-derived default. Only `"active"` is understood: the
	 * active note's property at trigger time. Stored lowercased; any other value
	 * is ignored.
	 */
	defaultFrom?: string;
	caseSensitive?: boolean;
	excludeFolders?: string[];
	excludeTags?: string[];
	excludeFiles?: string[];
}

/** What the shared `|key:value` grammar reads out of a token's pipe segments. */
export interface ParsedFilterSegments {
	filters: FieldFilter;
	multiSelect?: boolean;
	multiFormat?: MultiValueFormat;
	/** The prompt's own wording, shown instead of "Enter value for <field>". */
	label?: string;
	/** The run variable the answer is read from and written to, as `{{VALUE:<name>}}` does. */
	name?: string;
}

/** A segment the shared grammar skipped because it can do nothing with it. */
export type SkippedFilterSegment =
	/** A key outside {@link FIELD_FILTER_KEYS}, or a bare word that is not `multi`. */
	| { kind: "unknown"; key: string }
	/** A recognised key written without its value, e.g. `|folder`. */
	| { kind: "valueless"; key: string }
	/** `|name:` naming a reserved run variable. */
	| { kind: "reserved-name"; value: string };

interface FilterSegmentOptions {
	/** The token as written, for warning text, e.g. `{{FIELD:status|format:x}}`. */
	token: string;
	/** Hears mistakes in a value: an unsupported `|format:`, or `|format:` without `|multi`. */
	warn?: WarnSink;
	/**
	 * Hears each segment the grammar skipped. Only the FIELD grammar listens: the
	 * FILE, property: and capture grammars carry keys of their own and read those
	 * elsewhere.
	 */
	onSkipped?: (segment: SkippedFilterSegment) => void;
}

/**
 * Parses the `|key:value` segments the FIELD, FILE, property: and capture
 * grammars share (everything after the token's first segment).
 */
export function parseFilterSegments(
	segments: readonly string[],
	options: FilterSegmentOptions,
): ParsedFilterSegments {
	const filters: FieldFilter = {};
	let multiSelect = false;
	let multiFormat: MultiValueFormat = "auto";
	let multiFormatExplicit = false;
	let label: string | undefined;
	let name: string | undefined;

	for (const rawSegment of segments) {
		const filterPart = rawSegment.trim();
		if (filterPart.toLowerCase() === "multi") {
			multiSelect = true;
			continue;
		}

		const parsed = parsePipeKeyValue(filterPart);
		if (!parsed) {
			// A pipe part with no colon. `multi` is the only legal bare flag and
			// was consumed above, so anything left here does nothing at all and
			// would otherwise vanish without a trace - `|mutli` quietly
			// downgrades a multi-select prompt to a single-select one. A
			// correctly spelled key is a different mistake (a missing value).
			const bareKey = filterPart.toLowerCase();
			if (bareKey) {
				options.onSkipped?.({
					kind: (FIELD_FILTER_KEYS as readonly string[]).includes(bareKey)
						? "valueless"
						: "unknown",
					key: bareKey,
				});
			}
			continue;
		}

		const filterType = parsed.key;
		const filterValue = parsed.value;

		// The key set - not the switch - decides what is recognised, so the
		// warning, the typo suggester and the dispatch below can never disagree
		// about the vocabulary.
		if (!(FIELD_FILTER_KEYS as readonly string[]).includes(filterType)) {
			options.onSkipped?.({ kind: "unknown", key: filterType });
			continue;
		}

		switch (filterType) {
			case "label":
				label = filterValue || undefined;
				break;
			case "name":
				if (!RESERVED_VALUE_NAMES.has(filterValue.toLowerCase())) {
					name = filterValue || undefined;
				} else {
					options.onSkipped?.({ kind: "reserved-name", value: filterValue });
				}
				break;
			case "multi":
				multiSelect = parseBooleanFlag(filterValue);
				break;
			case "format":
				multiFormatExplicit = true;
				multiFormat =
					parseMultiValueFormat(filterValue, options.token, options.warn) ?? "auto";
				break;
			case "folder":
				filters.folders ??= [];
				filters.folders.push(filterValue);
				if (!filters.folder) {
					filters.folder = filterValue;
				}
				break;
			case "tag":
				filters.tags ??= [];
				filters.tags.push(filterValue.startsWith("#") ? filterValue.substring(1) : filterValue);
				break;
			case "inline":
				filters.inline = filterValue.toLowerCase() === "true";
				break;
			case "inline-code-blocks":
				filters.inlineCodeBlocks ??= [];
				filters.inlineCodeBlocks.push(
					...filterValue
						.split(",")
						.map((value) => value.trim().toLowerCase())
						.filter((value) => value.length > 0),
				);
				break;
			case "default":
				filters.defaultValue = filterValue;
				break;
			case "default-from":
				// Only the requested source is recorded; the runtime and preflight
				// FIELD paths resolve it.
				filters.defaultFrom = filterValue.toLowerCase();
				break;
			case "default-empty":
				filters.defaultEmpty = filterValue.toLowerCase() === "true";
				break;
			case "default-always":
				filters.defaultAlways = filterValue.toLowerCase() === "true";
				break;
			case "case-sensitive":
				filters.caseSensitive = filterValue.toLowerCase() === "true";
				break;
			case "exclude-folder":
				filters.excludeFolders ??= [];
				filters.excludeFolders.push(filterValue);
				break;
			case "exclude-tag":
				filters.excludeTags ??= [];
				filters.excludeTags.push(filterValue.startsWith("#") ? filterValue.substring(1) : filterValue);
				break;
			case "exclude-file":
				filters.excludeFiles ??= [];
				filters.excludeFiles.push(filterValue);
				break;
		}
	}

	// Warn on ANY explicit |format: without |multi - including |format:auto,
	// which is a no-op the author probably didn't intend.
	if (!multiSelect && multiFormatExplicit) {
		options.warn?.(`QuickAdd: |format: needs |multi in "${options.token}"; ignoring.`);
		multiFormat = "auto";
	}

	return {
		filters,
		...(multiSelect ? { multiSelect } : {}),
		...(multiFormat !== "auto" ? { multiFormat } : {}),
		...(label ? { label } : {}),
		...(name ? { name } : {}),
	};
}

function describeSkippedSegment(skipped: SkippedFilterSegment, input: string): string {
	switch (skipped.kind) {
		case "unknown":
			return describeUnknownFieldFilter(skipped.key, input);
		case "valueless":
			return describeValuelessFieldFilter(skipped.key, input);
		case "reserved-name":
			return `QuickAdd: |name:${skipped.value} is reserved and was ignored in "{{FIELD:${input}}}". Choose a different name.`;
	}
}

export class FieldSuggestionParser {
	/**
	 * Parses the `{{FIELD:...}}` grammar: the field name, then the shared filter
	 * segments. With `warn`, every mistake is reported there; without it, parsing
	 * is silent for pre-passes that re-parse an already-reported token.
	 */
	static parse(
		input: string,
		options?: { warn?: WarnSink },
	): ParsedFilterSegments & { fieldName: string } {
		const [fieldName, ...segments] = splitPipeParts(input).map((p) => p.trim());
		const warn = options?.warn;
		return {
			fieldName,
			...parseFilterSegments(segments, {
				token: `{{FIELD:${input}}}`,
				warn,
				onSkipped: warn && ((skipped) => warn(describeSkippedSegment(skipped, input))),
			}),
		};
	}
}
