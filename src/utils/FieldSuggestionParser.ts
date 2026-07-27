import { NOTICE_WARN, type WarnSink } from "./warnSink";
import {
	parseBooleanFlag,
	parsePipeKeyValue,
	splitPipeParts,
} from "./pipeSyntax";
import { suggestSimilarKeys } from "./suggestSimilarKeys";

/**
 * Every filter key the `{{FIELD:...}}` grammar recognises, in the order the
 * fallback warning lists them.
 *
 * Authoritative, not descriptive: {@link FieldSuggestionParser.parse} tests
 * membership here BEFORE dispatching, so a `case` added to the switch without an
 * entry here stops working rather than silently drifting away from what the
 * warning advertises and what the typo suggester matches against. (`multi` is
 * both a bare flag and a `multi:true` key, and is spelled once for both.)
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
] as const;

/**
 * Wrong keys whose nearest neighbour is a worse answer than a sentence.
 *
 * `case-insensitive` is one edit family away from `case-sensitive`, so a plain
 * "did you mean" would tell someone who asked for insensitive matching to write
 * `case-sensitive:true` - silently inverting what they asked for. A negation is
 * not a typo, so it gets an explicit answer instead of a guess.
 */
const FIELD_FILTER_HINTS: Record<string, string> = {
	"case-insensitive":
		'matching is already case-insensitive; use "case-sensitive:true" to match exactly',
};

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
 * Names the mistake instead of reciting the vocabulary (issue #1564).
 *
 * The actionable clause comes BEFORE the echoed token so the three-line clamp on
 * the inline preview diagnostic (styles.css `.qa-preview-issue`) can never cut
 * the fix off. The full list survives only where it is genuinely the most useful
 * thing left to say: when nothing is close enough to name.
 */
export function describeUnknownFieldFilter(
	filterKey: string,
	input: string,
): string {
	const key = clampForMessage(filterKey, 32);
	const token = `"{{FIELD:${clampForMessage(input, 48)}}}"`;

	const hint = FIELD_FILTER_HINTS[filterKey];
	if (hint) {
		return `Unknown FIELD filter "${key}" - ${hint}. Ignored in ${token}.`;
	}

	const suggestions = suggestSimilarKeys(filterKey, FIELD_FILTER_KEYS);
	if (suggestions.length > 0) {
		return `Unknown FIELD filter "${key}" - did you mean ${quoteList(suggestions)}? Ignored in ${token}.`;
	}

	return `Unknown FIELD filter "${key}" in ${token} was ignored. Supported filters: ${FIELD_FILTER_KEYS.join(", ")}.`;
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
	 * Source for a context-derived default (issue #1429). The only value v1
	 * understands is `"active"`: resolve the default from the active note's
	 * current frontmatter property at QuickAdd trigger time. Stored lowercased;
	 * an unrecognized source is ignored (the FIELD prompt behaves as if no
	 * `default-from` were present). Intentionally distinct from the literal
	 * `default:` option and from `default:current` (see the issue's rationale).
	 */
	defaultFrom?: string;
	caseSensitive?: boolean;
	excludeFolders?: string[];
	excludeTags?: string[];
	excludeFiles?: string[];
}

function warnUnknownFilter(
	filterKey: string,
	input: string,
	options: { warn?: WarnSink },
): void {
	(options.warn ?? NOTICE_WARN)(describeUnknownFieldFilter(filterKey, input));
}

export class FieldSuggestionParser {
	/**
	 * Parses the field suggestion syntax to extract field name and filters
	 * Examples:
	 * - "fieldname" -> { fieldName: "fieldname", filters: {} }
	 * - "fieldname|folder:daily" -> { fieldName: "fieldname", filters: { folder: "daily" } }
	 * - "fieldname|folder:daily|tag:work|tag:project" -> { fieldName: "fieldname", filters: { folder: "daily", tags: ["work", "project"] } }
	 */
	static parse(
		input: string,
		options?: { warnUnknown?: boolean; warn?: WarnSink },
	): {
		fieldName: string;
		filters: FieldFilter;
		multiSelect?: boolean;
	} {
		const parts = splitPipeParts(input).map((p) => p.trim());
		const fieldName = parts[0];
		const filters: FieldFilter = {};
		let multiSelect = false;

		for (let i = 1; i < parts.length; i++) {
			const filterPart = parts[i];
			if (filterPart.toLowerCase() === "multi") {
				multiSelect = true;
				continue;
			}

			const parsed = parsePipeKeyValue(filterPart);
			if (!parsed) {
				// A pipe part with no colon. `multi` is the only legal bare flag and
				// was consumed above, so anything left here is a mistyped filter that
				// would otherwise vanish without a trace - including `|mutli`, which
				// quietly downgrades a multi-select prompt to a single-select one.
				if (options?.warnUnknown && filterPart) {
					warnUnknownFilter(filterPart.toLowerCase(), input, options);
				}
				continue;
			}

			const filterType = parsed.key;
			const filterValue = parsed.value;

			// The key set - not the switch - decides what is recognised, so the
			// warning, the typo suggester and the dispatch below can never disagree
			// about the vocabulary.
			if (!(FIELD_FILTER_KEYS as readonly string[]).includes(filterType)) {
				// ONLY for the {{FIELD}} grammar (warnUnknown). This parser is also
				// shared by the {{FILE:...|label:/name:}}, property:, and
				// capture-scope grammars, which legitimately carry keys this switch
				// does not know and peel off elsewhere; warning there would emit
				// false "Unknown FIELD filter" notices and leak internal sentinels
				// like __capture_scope.
				if (options?.warnUnknown) {
					warnUnknownFilter(filterType, input, options);
				}
				continue;
			}

			switch (filterType) {
				case "multi":
					multiSelect = parseBooleanFlag(filterValue);
					break;
				case "folder":
					if (!filters.folders) {
						filters.folders = [];
					}
					filters.folders.push(filterValue);
					if (!filters.folder) {
						filters.folder = filterValue;
					}
					break;
				case "tag": {
					if (!filters.tags) {
						filters.tags = [];
					}
					// Remove # prefix if present
					const tagName = filterValue.startsWith("#")
						? filterValue.substring(1)
						: filterValue;
					filters.tags.push(tagName);
					break;
				}
				case "inline":
					filters.inline = filterValue.toLowerCase() === "true";
					break;
				case "inline-code-blocks":
					if (!filters.inlineCodeBlocks) {
						filters.inlineCodeBlocks = [];
					}
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
					// e.g. |default-from:active — resolve the default from a context
					// source (the active note's property) rather than a literal value.
					// The resolution happens in the runtime/preflight FIELD paths; here
					// we only record the requested source (lowercased).
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
					if (!filters.excludeFolders) {
						filters.excludeFolders = [];
					}
					filters.excludeFolders.push(filterValue);
					break;
				case "exclude-tag": {
					if (!filters.excludeTags) {
						filters.excludeTags = [];
					}
					// Remove # prefix if present
					const excludeTagName = filterValue.startsWith("#")
						? filterValue.substring(1)
						: filterValue;
					filters.excludeTags.push(excludeTagName);
					break;
				}
				case "exclude-file":
					if (!filters.excludeFiles) {
						filters.excludeFiles = [];
					}
					filters.excludeFiles.push(filterValue);
					break;
			}
		}

		return multiSelect
			? { fieldName, filters, multiSelect }
			: { fieldName, filters };
	}
}
