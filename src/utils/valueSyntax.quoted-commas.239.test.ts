import { describe, expect, it } from "vitest";
import {
	parseValueToken,
	splitQuotedCommaList,
	unwrapQuotedValue,
} from "./valueSyntax";

// #239: allow a comma inside a single {{VALUE:a,b}} option by quoting it.
// The headline invariant: any list WITHOUT a balanced double-quoted field
// parses byte-identically to the pre-#239 naive comma split.

describe("splitQuotedCommaList — the fix", () => {
	it("keeps a comma inside a double-quoted option (issue example)", () => {
		expect(
			splitQuotedCommaList(
				'"This is a single choice, with a comma",Second Choice',
			),
		).toEqual(["This is a single choice, with a comma", "Second Choice"]);
	});

	it("honors the reporter's verbatim paste with a CURLY close-quote", () => {
		// The #239 body pastes a straight open-quote and a curly U+201D close.
		expect(
			splitQuotedCommaList(
				'"This is a single choice, with a comma”,Second Choice',
			),
		).toEqual(["This is a single choice, with a comma", "Second Choice"]);
	});

	it("supports fully curly-quoted fields", () => {
		expect(splitQuotedCommaList("“a, b”,c")).toEqual(["a, b", "c"]);
	});

	it("treats `\"\"` inside a quoted field as one literal quote", () => {
		expect(splitQuotedCommaList('"a""b",c')).toEqual(['a"b', "c"]);
	});

	it("allows a leading space before an opening quote (later fields)", () => {
		expect(splitQuotedCommaList('a, "b, c"')).toEqual(["a", "b, c"]);
	});

	it("strips quotes from every quoted field", () => {
		expect(splitQuotedCommaList('"A",B,"C"')).toEqual(["A", "B", "C"]);
	});

	it("supports a quoted comma-only field", () => {
		expect(splitQuotedCommaList('","')).toEqual([","]);
	});
});

describe("splitQuotedCommaList — strict close reverts to legacy", () => {
	it("a quote closed by other text is not real quoting", () => {
		// next char after the close is text, not a comma/EOF -> legacy split.
		expect(splitQuotedCommaList('"a"b,c')).toEqual(['"a"b', "c"]);
		expect(splitQuotedCommaList('"Hello" he said,next')).toEqual([
			'"Hello" he said',
			"next",
		]);
	});

	it("an unterminated quote falls back to a plain split", () => {
		expect(splitQuotedCommaList('"oops,more')).toEqual(['"oops', "more"]);
	});

	it("honors non-breaking / unicode space between a close quote and comma", () => {
		// NBSP (U+00A0) can arrive from rich-text paste; it must not break
		// the close. Plain space and tab are covered too.
		expect(splitQuotedCommaList('"a"\u00a0,b')).toEqual(["a", "b"]);
		expect(splitQuotedCommaList('"a, b" ,c')).toEqual(["a, b", "c"]);
		expect(splitQuotedCommaList('"a"\t,c')).toEqual(["a", "c"]);
	});

	it("interleaved quotes mid-field stay literal", () => {
		expect(splitQuotedCommaList('say "hi" yo,next')).toEqual([
			'say "hi" yo',
			"next",
		]);
	});

	it("a double-quote in an UNquoted field never opens a span", () => {
		// buf is non-empty when the quote appears, so `a""b` stays literal.
		expect(splitQuotedCommaList("a\"\"b,c")).toEqual(['a""b', "c"]);
	});
});

describe("splitQuotedCommaList — backward-compat property (no double quotes)", () => {
	it("is byte-identical to input.split(',') for every double-quote-free input", () => {
		const alphabet = ["a", "b", ",", " ", "'", "|"];
		let checked = 0;
		let mismatches = 0;
		const enumerate = (prefix: string, depth: number) => {
			if (depth === 0) return;
			for (const ch of alphabet) {
				const s = prefix + ch;
				checked++;
				const got = splitQuotedCommaList(s);
				const want = s.split(",");
				if (JSON.stringify(got) !== JSON.stringify(want)) mismatches++;
				enumerate(s, depth - 1);
			}
		};
		enumerate("", 4);
		expect(checked).toBeGreaterThan(1500);
		expect(mismatches).toBe(0);
	});

	it("unbalanced fallback re-enters the same trim/filter post-processing", () => {
		for (const s of [' "a , , b ', '"x, ,y', '  ,  ,  ', '"only open']) {
			const got = splitQuotedCommaList(s).map((v) => v.trim()).filter(Boolean);
			const legacy = s
				.split(",")
				.map((v) => v.trim())
				.filter(Boolean);
			expect(got).toEqual(legacy);
		}
	});
});

describe("parseValueToken — option values", () => {
	it("reproduces the fix end-to-end (issue example -> two clean options)", () => {
		const parsed = parseValueToken(
			'"This is a single choice, with a comma",Second Choice',
		);
		expect(parsed?.suggestedValues).toEqual([
			"This is a single choice, with a comma",
			"Second Choice",
		]);
		expect(parsed?.hasOptions).toBe(true);
	});

	it("apostrophes are untouched (single quote is not special)", () => {
		expect(parseValueToken("Bob's,Alice's")?.suggestedValues).toEqual([
			"Bob's",
			"Alice's",
		]);
		expect(parseValueToken("'tis,'twas")?.suggestedValues).toEqual([
			"'tis",
			"'twas",
		]);
	});

	it("a single quoted field collapses to one option (suggester -> prompt)", () => {
		// Documented control-type flip: one option => hasOptions=false.
		const parsed = parseValueToken('"a, b"');
		expect(parsed?.suggestedValues).toEqual(["a, b"]);
		expect(parsed?.hasOptions).toBe(false);
	});

	it("drops an empty quoted option", () => {
		expect(parseValueToken('"",a')?.suggestedValues).toEqual(["a"]);
	});
});

describe("parseValueToken — text: labels", () => {
	it("honors quoted commas in display labels and aligns the count", () => {
		const parsed = parseValueToken('a,b|text:"X, Y",Z');
		expect(parsed?.suggestedValues).toEqual(["a", "b"]);
		expect(parsed?.displayValues).toEqual(["X, Y", "Z"]);
	});

	it("a quoted-comma label that desyncs the count throws with a quoting hint", () => {
		// Was incidentally valid pre-#239 (naive 3==3); now items=3, labels=2.
		expect(() => parseValueToken('x,y,z|text:"a,b",c')).toThrow(
			/double quotes/i,
		);
	});
});

describe("parseValueToken — default: unwrap on option lists", () => {
	it("unwraps a quoted comma default so it matches its option", () => {
		const parsed = parseValueToken('c,"a, b"|default:"a, b"');
		expect(parsed?.suggestedValues).toEqual(["c", "a, b"]);
		expect(parsed?.defaultValue).toBe("a, b");
		expect(parsed?.suggestedValues).toContain(parsed?.defaultValue);
	});

	it("unwraps a curly-quoted default", () => {
		const parsed = parseValueToken('c,"a, b"|default:“a, b”');
		expect(parsed?.defaultValue).toBe("a, b");
	});

	it("leaves an unquoted default untouched", () => {
		expect(parseValueToken("a,b|default:b")?.defaultValue).toBe("b");
	});

	it("does not unwrap a single-value (non-option) default", () => {
		// hasOptions=false, so a quoted default stays literal.
		expect(parseValueToken('title|default:"x"')?.defaultValue).toBe('"x"');
	});
});

describe("unwrapQuotedValue", () => {
	it("strips a surrounding straight or curly pair and unescapes ``\"\"``", () => {
		expect(unwrapQuotedValue('"a, b"')).toBe("a, b");
		expect(unwrapQuotedValue("“a, b”")).toBe("a, b");
		expect(unwrapQuotedValue('"a""b"')).toBe('a"b');
	});

	it("passes unquoted values through unchanged", () => {
		expect(unwrapQuotedValue("a, b")).toBe("a, b");
		expect(unwrapQuotedValue("plain")).toBe("plain");
		expect(unwrapQuotedValue('"unbalanced')).toBe('"unbalanced');
	});

	it("is strict like the splitter: leaves malformed/multi-field values literal", () => {
		// Same grammar as splitQuotedCommaList — not a naive first/last strip.
		expect(unwrapQuotedValue('"a","b"')).toBe('"a","b"');
		expect(unwrapQuotedValue('"a"b"')).toBe('"a"b"');
		expect(unwrapQuotedValue('"a""')).toBe('"a""');
	});
});

describe("strict-close fallback via the parseValueToken entry point", () => {
	it("keeps literal quotes when a quote is closed by other text", () => {
		expect(parseValueToken('"a"b,c')?.suggestedValues).toEqual([
			'"a"b',
			"c",
		]);
	});
});
