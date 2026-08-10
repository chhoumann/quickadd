import { describe, expect, it } from "vitest";
import {
	describeUnknownFieldFilter,
	FIELD_FILTER_KEYS,
	FieldSuggestionParser,
} from "./FieldSuggestionParser";
import { suggestSimilarKeys } from "./suggestSimilarKeys";

/**
 * Issue #1564. The warning used to answer every mistyped filter key by reciting
 * all thirteen supported keys - 256 characters, of which the last 180 were a
 * list you had to read to the end to discover the answer was `folder` all along.
 *
 * The table below is the contract. It is deliberately exhaustive about what is
 * NOT suggested too: a confidently wrong "did you mean" is worse than the list,
 * and one of them (`case-insensitive` -> `case-sensitive`) would invert the
 * user's own request. A new filter key must be added to this table, which is the
 * point - it is the only place that would notice the addition changing an
 * existing answer.
 */
const SUGGESTIONS: Array<[typed: string, expected: string[]]> = [
	// Typos: transposition, doubled/dropped letter, missing separator.
	["fodler", ["folder"]],
	["foldr", ["folder"]],
	["mutli", ["multi"]],
	["inlne", ["inline"]],
	["dafault", ["default"]],
	["excludetag", ["exclude-tag"]],
	["case-sensitve", ["case-sensitive"]],
	// Right family, wrong key.
	["tags", ["tag"]],
	["folders", ["folder"]],
	["exclude", ["exclude-folder", "exclude-tag", "exclude-file"]],
	["case", ["case-sensitive"]],
	["inline-code", ["inline-code-blocks", "inline"]],
	["multi-select", ["multi"]],
	// Half-typed, which is most of what a live preview sees.
	["fo", ["folder", "format"]],
	["de", ["default", "default-from", "default-empty"]],
	// Not a typo of anything: no guess, fall back to the vocabulary.
	["filter", []],
	["sortby", []],
	["limit", []],
	["path", []],
	["f", []],
];

describe("suggestSimilarKeys over the real FIELD filter vocabulary", () => {
	it.each(SUGGESTIONS)("%s -> %j", (typed, expected) => {
		expect(suggestSimilarKeys(typed, FIELD_FILTER_KEYS)).toEqual(expected);
	});

	it("never answers a negation with the key it negates", () => {
		// The distance rule alone WOULD reach case-sensitive from here; the message
		// layer must not let it, because obeying the suggestion inverts the request.
		expect(
			describeUnknownFieldFilter("case-insensitive", "status|case-insensitive:true"),
		).toBe(
			'Unknown FIELD filter "case-insensitive" - matching is already case-insensitive; use "case-sensitive:true" to match exactly. Ignored in {{FIELD:status|case-insensitive:true}}.',
		);
	});

	it("suggests nothing for a key it already recognises", () => {
		for (const key of FIELD_FILTER_KEYS) {
			expect(suggestSimilarKeys(key, FIELD_FILTER_KEYS)).not.toContain(key);
		}
	});
});

describe("describeUnknownFieldFilter", () => {
	it("leads with the fix, not with the vocabulary", () => {
		const message = describeUnknownFieldFilter("fodler", "status|fodler:abc");
		expect(message).toBe(
			'Unknown FIELD filter "fodler" - did you mean "folder"? Ignored in {{FIELD:status|fodler:abc}}.',
		);
		// The message this replaced was 256 characters.
		expect(message.length).toBeLessThan(120);
	});

	it("lists several candidates when the family is ambiguous", () => {
		expect(describeUnknownFieldFilter("exclude", "status|exclude:x")).toBe(
			'Unknown FIELD filter "exclude" - did you mean "exclude-folder", "exclude-tag" or "exclude-file"? Ignored in {{FIELD:status|exclude:x}}.',
		);
	});

	it("keeps the full vocabulary when nothing is close", () => {
		const message = describeUnknownFieldFilter("sortby", "status|sortby:x");
		expect(message).toBe(
			'Unknown FIELD filter "sortby" in {{FIELD:status|sortby:x}} was ignored. Supported filters: folder, tag, inline, inline-code-blocks, exclude-folder, exclude-tag, exclude-file, default, default-from, default-empty, default-always, case-sensitive, multi, format.',
		);
	});

	it("bounds the message no matter how long the key and the token are", () => {
		const message = describeUnknownFieldFilter(
			"x".repeat(400),
			`status|${"y".repeat(400)}:z`,
		);
		// Only the fixed vocabulary is left; the two user-controlled parts are
		// clamped, so an absurd token cannot re-inflate what #1564 shrank.
		expect(message).toContain(`"${"x".repeat(32)}…"`);
		expect(message).toContain(`{{FIELD:status|${"y".repeat(41)}…}}`);
		expect(message.length).toBeLessThan(340);
	});
});

describe("FieldSuggestionParser warns through the new message", () => {
	function parse(input: string, warnUnknown = true) {
		const warnings: string[] = [];
		const result = FieldSuggestionParser.parse(input, {
			warnUnknown,
			warn: (message) => warnings.push(message),
		});
		return { result, warnings };
	}

	it("diagnoses a mistyped filter key", () => {
		const { warnings } = parse("status|fodler:abc");
		expect(warnings).toEqual([
			'Unknown FIELD filter "fodler" - did you mean "folder"? Ignored in {{FIELD:status|fodler:abc}}.',
		]);
	});

	it("never answers a prototype member as if it were a hint", () => {
		// The hint table is keyed by whatever the user typed after a pipe, and an
		// object lookup would answer `constructor` with Object itself - stringified
		// into the warning as "function Object() { [native code] }".
		for (const key of ["constructor", "__proto__", "tostring", "valueof"]) {
			const message = describeUnknownFieldFilter(key, `status|${key}:x`);
			expect(message).not.toContain("native code");
			expect(message).not.toContain("[object Object]");
			expect(message).toContain(`Unknown FIELD filter "${key}"`);
		}
	});

	it("tells a correctly spelled filter it is missing its value, not that it is unknown", () => {
		// `|folder` is one keystroke short of `|folder:`, which a live preview sees
		// constantly. Calling it unknown and then listing `folder` among the
		// supported filters contradicts itself; running it through the suggester
		// answers it with a sibling key, because the suggester excludes the exact
		// match from its own pool.
		for (const key of FIELD_FILTER_KEYS) {
			if (key === "multi") continue; // the one legal bare flag
			const { warnings } = parse(`status|${key}`);
			expect(warnings).toEqual([
				`FIELD filter "${key}" needs a value - write "${key}:value". Ignored in {{FIELD:status|${key}}}.`,
			]);
		}
	});

	it("warns about a mistyped bare flag, which used to vanish silently", () => {
		// `|mutli` parses as no filter at all: the prompt quietly stays
		// single-select and nothing anywhere says why.
		const { result, warnings } = parse("status|mutli");
		expect(result.multiSelect).toBeUndefined();
		expect(warnings).toEqual([
			'Unknown FIELD filter "mutli" - did you mean "multi"? Ignored in {{FIELD:status|mutli}}.',
		]);
	});

	it("stays silent for every recognised filter, bare flag included", () => {
		const { warnings } = parse(
			"status|folder:a|tag:b|inline:true|inline-code-blocks:c|exclude-folder:d|exclude-tag:e|exclude-file:f|default:g|default-from:active|default-empty:true|default-always:true|case-sensitive:true|multi",
		);
		expect(warnings).toEqual([]);
	});

	it("stays silent for an empty trailing pipe part", () => {
		expect(parse("status|").warnings).toEqual([]);
	});

	it("stays silent for the grammars that legitimately carry foreign keys", () => {
		expect(parse("status|__capture_scope:x|label:y", false).warnings).toEqual([]);
	});

	it("still parses every recognised filter after the membership gate", () => {
		const { result } = parse("status|folder:Work|tag:#a|exclude-tag:b|multi:true");
		expect(result.fieldName).toBe("status");
		expect(result.filters.folder).toBe("Work");
		expect(result.filters.folders).toEqual(["Work"]);
		expect(result.filters.tags).toEqual(["a"]);
		expect(result.filters.excludeTags).toEqual(["b"]);
		expect(result.multiSelect).toBe(true);
	});
});
