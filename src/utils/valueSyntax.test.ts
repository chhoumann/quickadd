import { describe, expect, it, vi, afterEach } from "vitest";
import {
	buildValueVariableKey,
	normalizeNumericValue,
	normalizeSliderValue,
	parseAnonymousValueOptions,
	parseValueToken,
	resolveExistingVariableKey,
} from "./valueSyntax";
import { SILENT_WARN } from "./warnSink";
import { log } from "../logger/logManager";

describe("parseValueToken", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it.each([
		{
			name: "ignores empty label values",
			input: "title|label:",
			expected: { label: undefined, variableKey: "title" },
		},
		{
			name: "uses the last label when multiple are provided",
			input: "title|label:First|label:Second",
			expected: { label: "Second" },
		},
		{
			name: "treats bare label option as legacy default",
			input: "title|label",
			expected: { label: undefined, defaultValue: "label" },
		},
		{
			name: "parses case style without treating it as legacy default",
			input: "title|case:kebab",
			expected: { caseStyle: "kebab", defaultValue: "" },
		},
		{
			name: "parses trim without treating it as a legacy default",
			input: "title|trim",
			expected: { trim: true, defaultValue: "", variableKey: "title" },
		},
		{
			name: "parses title case style",
			input: "title|case:title",
			expected: { caseStyle: "title" },
		},
		{
			name: "parses text mappings for option lists",
			input: "a,b|text:Alpha,Beta",
			expected: { suggestedValues: ["a", "b"], displayValues: ["Alpha", "Beta"] },
		},
		{
			name: "allows custom plus explicit default",
			input: "a,b|custom|default:High",
			expected: { allowCustomInput: true, defaultValue: "High" },
		},
		{
			name: "parses multiline type with label and default",
			input: "Body|type:multiline|label:Notes|default:Hello",
			expected: { variableName: "Body", inputTypeOverride: "multiline", label: "Notes", defaultValue: "Hello" },
		},
		{
			name: "ignores shorthand default when type is present",
			input: "Body|Hello|type:multiline",
			expected: { defaultValue: "", inputTypeOverride: "multiline" },
		},
		{
			name: "parses numeric constraints for number inputs",
			input: "Rating|type:number|min:1|max:10|step:0.5",
			expected: { inputTypeOverride: "number", numericConfig: { min: 1, max: 10, step: 0.5 } },
		},
		{
			name: "defaults slider step to one when omitted",
			input: "Rating|type:slider|min:-5|max:5",
			expected: { sliderConfig: { min: -5, max: 5, step: 1 } },
		},
		{
			name: "parses |multi on an option list",
			input: "work,home,urgent|multi",
			expected: { multiSelect: true, multiEmit: "text" },
		},
		{
			name: "parses |multi:linklist",
			input: "Alice,Bob|multi:linklist",
			expected: { multiSelect: true, multiEmit: "linklist" },
		},
	])("$name", ({ input, expected }) => {
		expect(parseValueToken(input)).toEqual(expect.objectContaining(expected));
	});

	it("scopes list variables by label", () => {
		const parsed = parseValueToken("a,b|label:Priority");
		expect(parsed?.hasOptions).toBe(true);
		const expectedKey = buildValueVariableKey("a,b", "Priority", true);
		expect(parsed?.variableKey).toBe(expectedKey);
	});

	it("supports keyed trim flags", () => {
		expect(parseValueToken("title|trim:true")?.trim).toBe(true);
		expect(parseValueToken("title|trim:false")?.trim).toBe(false);
		expect(parseValueToken("title|trim|trim:false")?.trim).toBe(false);
	});

	it("parses custom boolean values", () => {
		expect(parseValueToken("a,b|custom:")?.allowCustomInput).toBe(true);
		expect(parseValueToken("a,b|custom:false")?.allowCustomInput).toBe(false);
		expect(parseValueToken("a,b|custom:0")?.allowCustomInput).toBe(false);
	});

	it("throws when text mappings are used on single-value tokens", () => {
		expect(() => parseValueToken("title|text:Title")).toThrow(
			/only supported for option-list/i,
		);
	});

	it("throws when text mappings and items have different lengths", () => {
		expect(() => parseValueToken("a,b|text:Alpha")).toThrow(
			/same number of text entries and item entries/i,
		);
	});

	it("throws when text mappings contain duplicate labels", () => {
		expect(() => parseValueToken("a,b|text:Alpha,Alpha")).toThrow(
			/duplicate text entries/i,
		);
	});

	it("warns and ignores unknown type values", () => {
		const warnSpy = vi.spyOn(log, "logWarning").mockImplementation(() => {});
		const parsed = parseValueToken("Body|type:wide");
		expect(parsed?.inputTypeOverride).toBeUndefined();
		expect(warnSpy).toHaveBeenCalled();
	});

	it("warns and ignores type for option lists", () => {
		const warnSpy = vi.spyOn(log, "logWarning").mockImplementation(() => {});
		const parsed = parseValueToken("Red,Green|type:multiline");
		expect(parsed?.inputTypeOverride).toBeUndefined();
		expect(warnSpy).toHaveBeenCalled();
	});

	it("parses type:number / checkbox / text without warning", () => {
		const warnSpy = vi.spyOn(log, "logWarning").mockImplementation(() => {});
		expect(parseValueToken("Rating|type:number")?.inputTypeOverride).toBe(
			"number",
		);
		expect(parseValueToken("Done|type:checkbox")?.inputTypeOverride).toBe(
			"checkbox",
		);
		expect(parseValueToken("Note|type:text")?.inputTypeOverride).toBe(
			"text",
		);
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it("keeps min/max/step as shorthand defaults unless a numeric type is present", () => {
		expect(parseValueToken("x|min:5")?.defaultValue).toBe("min:5");
		expect(parseValueToken("x|min:5|max:10")?.defaultValue).toBe(
			"min:5|max:10",
		);
	});

	it("parses slider type only with an explicit valid range", () => {
		const warnSpy = vi.spyOn(log, "logWarning").mockImplementation(() => {});
		const parsed = parseValueToken("Rating|type:slider|min:1|max:10|step:0.5");
		expect(parsed?.inputTypeOverride).toBe("slider");
		expect(parsed?.numericConfig).toEqual({ min: 1, max: 10, step: 0.5 });
		expect(parsed?.sliderConfig).toEqual({ min: 1, max: 10, step: 0.5 });
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it("falls back to number for slider tokens without finite min and max", () => {
		const warnSpy = vi.spyOn(log, "logWarning").mockImplementation(() => {});
		const parsed = parseValueToken("Rating|type:slider|max:10");
		expect(parsed?.inputTypeOverride).toBe("number");
		expect(parsed?.numericConfig).toEqual({ max: 10 });
		expect(parsed?.sliderConfig).toBeUndefined();
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("falling back to type:number"),
		);
	});

	it("falls back to number for invalid slider ranges and steps", () => {
		const warnSpy = vi.spyOn(log, "logWarning").mockImplementation(() => {});
		const invalidRange = parseValueToken("Rating|type:slider|min:10|max:1");
		const invalidStep = parseValueToken(
			"Rating|type:slider|min:1|max:10|step:0",
		);
		expect(invalidRange?.inputTypeOverride).toBe("number");
		expect(invalidRange?.numericConfig).toBeUndefined();
		expect(invalidStep?.inputTypeOverride).toBe("number");
		expect(invalidStep?.numericConfig).toEqual({ min: 1, max: 10 });
		expect(warnSpy).toHaveBeenCalledTimes(2);
	});

	it("normalizes numeric values to bounds and step", () => {
		expect(normalizeNumericValue("999", { min: 1, max: 10 })).toBe("10");
		expect(normalizeNumericValue("-5", { min: 1, max: 10 })).toBe("1");
		expect(normalizeNumericValue("4", { min: 1, max: 10, step: 2 })).toBe(
			"5",
		);
		expect(normalizeNumericValue("0.26", { min: 0, max: 1, step: 0.25 })).toBe(
			"0.25",
		);
		expect(normalizeNumericValue("garbage", { min: 1, max: 10 })).toBe("");
	});

	it("normalizes slider values to a concrete bounded value", () => {
		const config = { min: 1, max: 10, step: 2 };
		expect(normalizeSliderValue("999", config)).toBe("10");
		expect(normalizeSliderValue("-5", config)).toBe("1");
		expect(normalizeSliderValue("4", config)).toBe("5");
		expect(normalizeSliderValue("garbage", config)).toBe("1");
	});

	it("treats type:boolean as an alias for checkbox", () => {
		expect(parseValueToken("Done|type:boolean")?.inputTypeOverride).toBe(
			"checkbox",
		);
	});

	it("still rejects an unknown type and names the new supported set", () => {
		const warnSpy = vi.spyOn(log, "logWarning").mockImplementation(() => {});
		expect(parseValueToken("Body|type:wide")?.inputTypeOverride).toBeUndefined();
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("multiline, number, slider, checkbox, text"),
		);
	});

	it("ignores a scalar type on an option-list token", () => {
		const warnSpy = vi.spyOn(log, "logWarning").mockImplementation(() => {});
		expect(
			parseValueToken("Red,Green|type:number")?.inputTypeOverride,
		).toBeUndefined();
		expect(warnSpy).toHaveBeenCalled();
	});

	it.each(["yaml", "markdown", "inline", "spaced"] as const)(
		"parses |format:%s separately from |multi item emission",
		(format) => {
			const parsed = parseValueToken(
				`Alice,Bob|multi:linklist|format:${format}`,
			);
			expect(parsed?.multiSelect).toBe(true);
			expect(parsed?.multiEmit).toBe("linklist");
			expect(parsed?.multiFormat).toBe(format);
		},
	);

	it("warns and ignores an explicit format without |multi", () => {
		const warnSpy = vi.spyOn(log, "logWarning").mockImplementation(() => {});
		expect(parseValueToken("Only|format:yaml")?.multiFormat).toBe("auto");
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("needs |multi"));
	});

	it("warns on an explicit |format:auto without |multi (a silent no-op otherwise)", () => {
		const warnSpy = vi.spyOn(log, "logWarning").mockImplementation(() => {});
		expect(parseValueToken("Only|format:auto")?.multiFormat).toBe("auto");
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("needs |multi"));
	});

	it("warns and ignores |multi without an option list", () => {
		const warnSpy = vi.spyOn(log, "logWarning").mockImplementation(() => {});
		expect(parseValueToken("Only|multi")?.multiSelect).toBe(false);
		expect(parseValueToken("Only|multi:linklist")?.multiSelect).toBe(false);
		expect(warnSpy).toHaveBeenCalled();
	});

	it("composes |multi with |custom and |name", () => {
		const custom = parseValueToken("a,b|multi|custom");
		expect(custom?.multiSelect).toBe(true);
		expect(custom?.allowCustomInput).toBe(true);
		const named = parseValueToken("a,b|multi|name:tags");
		expect(named?.multiSelect).toBe(true);
		expect(named?.aliasName).toBe("tags");
	});

	it("drops |case when combined with |multi (a list is not case-transformed)", () => {
		const warnSpy = vi.spyOn(log, "logWarning").mockImplementation(() => {});
		const parsed = parseValueToken("a,b,c|multi|case:upper");
		expect(parsed?.multiSelect).toBe(true);
		expect(parsed?.caseStyle).toBeUndefined();
		expect(warnSpy).toHaveBeenCalled();
	});

	it("leaves multiSelect false for ordinary option lists", () => {
		expect(parseValueToken("a,b,c")?.multiSelect).toBe(false);
		expect(parseValueToken("a,b,c|custom")?.multiSelect).toBe(false);
	});
});

describe("parseAnonymousValueOptions", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("parses multiline type for unnamed VALUE tokens", () => {
		const parsed = parseAnonymousValueOptions(
			"|type:multiline|label:Notes|default:Hello",
		);
		expect(parsed.inputTypeOverride).toBe("multiline");
		expect(parsed.label).toBe("Notes");
		expect(parsed.defaultValue).toBe("Hello");
	});

	it("parses slider type and numeric config for unnamed VALUE tokens", () => {
		const parsed = parseAnonymousValueOptions(
			"|type:slider|min:1|max:10|step:1|default:5",
		);
		expect(parsed.inputTypeOverride).toBe("slider");
		expect(parsed.numericConfig).toEqual({ min: 1, max: 10, step: 1 });
		expect(parsed.sliderConfig).toEqual({ min: 1, max: 10, step: 1 });
		expect(parsed.defaultValue).toBe("5");
	});

	it("parses case style for unnamed VALUE tokens", () => {
		const parsed = parseAnonymousValueOptions(
			"|case:kebab|label:Notes|default:Hello",
		);
		expect(parsed.caseStyle).toBe("kebab");
		expect(parsed.label).toBe("Notes");
		expect(parsed.defaultValue).toBe("Hello");
	});

	it("parses trim for unnamed VALUE tokens", () => {
		const parsed = parseAnonymousValueOptions("|trim|label:Notes");
		expect(parsed.trim).toBe(true);
		expect(parsed.label).toBe("Notes");
		expect(parsed.defaultValue).toBe("");
	});

	it("warns and ignores unknown type for unnamed VALUE tokens", () => {
		const warnSpy = vi.spyOn(log, "logWarning").mockImplementation(() => {});
		const parsed = parseAnonymousValueOptions("|type:wide");
		expect(parsed.inputTypeOverride).toBeUndefined();
		expect(warnSpy).toHaveBeenCalled();
	});

	it("throws when text mappings are used on unnamed VALUE tokens", () => {
		expect(() => parseAnonymousValueOptions("|text:Alpha,Beta")).toThrow(
			/only supported for option-list/i,
		);
	});

	it("does NOT treat name: as an option (anonymous path is unchanged by #148)", () => {
		// `name` is gated to the named {{VALUE:...}} grammar; on the anonymous
		// {{VALUE|...}} grammar it stays an ordinary legacy default value.
		const parsed = parseAnonymousValueOptions("|name:John");
		expect(parsed.defaultValue).toBe("name:John");
	});
});

describe("named variables (|name:, issue #148)", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it.each([
		{
			name: "keys an option list on the explicit name and exposes aliasName",
			input: "work,home,errand|name:category",
			expected: { hasOptions: true, aliasName: "category", variableKey: "category", suggestedValues: ["work", "home", "errand"] },
		},
		{
			name: "bypasses label scoping when a name is given",
			input: "a,b|name:category|label:Pick",
			expected: { variableKey: "category", label: "Pick" },
		},
		{
			name: "coexists with text and custom options",
			input: "a,b|name:category|text:Alpha,Beta|custom",
			expected: { aliasName: "category", variableKey: "category", displayValues: ["Alpha", "Beta"], allowCustomInput: true },
		},
	])("$name", ({ input, expected }) => {
		expect(parseValueToken(input)).toEqual(expect.objectContaining(expected));
	});

	it("warns and ignores reserved names", () => {
		const warnSpy = vi.spyOn(log, "logWarning").mockImplementation(() => {});
		const parsed = parseValueToken("a,b|name:title");
		expect(parsed?.aliasName).toBeUndefined();
		// Falls back to the option-list key (no alias).
		expect(parsed?.variableKey).toBe("a,b");
		expect(warnSpy).toHaveBeenCalled();
	});

	it("warns and ignores a name containing the reserved key delimiter", () => {
		const warnSpy = vi.spyOn(log, "logWarning").mockImplementation(() => {});
		const parsed = parseValueToken("a,b|name:foo\u001Fbar")
		expect(parsed?.aliasName).toBeUndefined();
		expect(parsed?.variableKey).toBe("a,b");
		expect(warnSpy).toHaveBeenCalled();
	});

	it("stays silent when parsed with a silent sink", () => {
		const warnSpy = vi.spyOn(log, "logWarning").mockImplementation(() => {});
		// Reserved name would normally warn; a silent sink (the pre-pass) drops it.
		const parsed = parseValueToken("a,b|name:title", { warn: SILENT_WARN });
		expect(parsed?.aliasName).toBeUndefined();
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it("warns and ignores an empty name", () => {
		const warnSpy = vi.spyOn(log, "logWarning").mockImplementation(() => {});
		const parsed = parseValueToken("a,b|name:");
		expect(parsed?.aliasName).toBeUndefined();
		expect(parsed?.variableKey).toBe("a,b");
		expect(warnSpy).toHaveBeenCalled();
	});

	it("honors but warns about name on a single value", () => {
		const warnSpy = vi.spyOn(log, "logWarning").mockImplementation(() => {});
		const parsed = parseValueToken("Some prompt|name:bar");
		expect(parsed?.hasOptions).toBe(false);
		expect(parsed?.aliasName).toBe("bar");
		expect(parsed?.variableKey).toBe("bar");
		expect(warnSpy).toHaveBeenCalled();
	});
});

describe("resolveExistingVariableKey", () => {
	it("returns exact key when present", () => {
		const vars = new Map<string, unknown>([["title", "Hello"]]);
		expect(resolveExistingVariableKey(vars, "title")).toBe("title");
	});

	it("falls back to base key for labeled tokens", () => {
		const vars = new Map<string, unknown>([["low,med,high", "med"]]);
		const key = buildValueVariableKey(
			"low,med,high",
			"Priority",
			true,
		);
		expect(resolveExistingVariableKey(vars, key)).toBe("low,med,high");
	});

	it("uses case-insensitive match when unique", () => {
		const vars = new Map<string, unknown>([["Title", "Value"]]);
		expect(resolveExistingVariableKey(vars, "title")).toBe("Title");
	});

	it("returns null for ambiguous case-insensitive matches", () => {
		const vars = new Map<string, unknown>([
			["Title", "One"],
			["TITLE", "Two"],
		]);
		expect(resolveExistingVariableKey(vars, "title")).toBeNull();
	});

	it("treats undefined as missing but allows null", () => {
		const vars = new Map<string, unknown>([
			["missing", undefined],
			["nullable", null],
		]);
		expect(resolveExistingVariableKey(vars, "missing")).toBeNull();
		expect(resolveExistingVariableKey(vars, "nullable")).toBe("nullable");
	});
});

describe("optional flag (issue #1259)", () => {
	it.each([
		{
			name: "recognizes a bare optional flag on a single-variable token",
			input: "reminder|optional",
			expected: { optional: true, defaultValue: "", variableKey: "reminder" },
		},
		{
			name: "preserves a shorthand default sitting next to the flag",
			input: "reminder|call mom|optional",
			expected: { optional: true, defaultValue: "call mom" },
		},
		{
			name: "joins remaining shorthand parts when the flag sits between them",
			input: "x|a|optional|b",
			expected: { optional: true, defaultValue: "a|b" },
		},
		{
			name: "keeps a literal default of 'optional' reachable via default:",
			input: "x|default:optional",
			expected: { optional: false, defaultValue: "optional" },
		},
		{
			name: "combines with keyed options without dropping them",
			input: "x|label:Why|optional",
			expected: { optional: true, label: "Why" },
		},
	])("$name", ({ input, expected }) => {
		expect(parseValueToken(input)).toEqual(expect.objectContaining(expected));
	});

	it("is case-insensitive and trims whitespace", () => {
		expect(parseValueToken("reminder| Optional ")?.optional).toBe(true);
		expect(parseValueToken("reminder|OPTIONAL")?.optional).toBe(true);
	});

	it("supports the keyed optional:<bool> form", () => {
		expect(parseValueToken("x|optional:true")?.optional).toBe(true);
		expect(parseValueToken("x|optional:false")?.optional).toBe(false);
		expect(parseValueToken("x|optional:no")?.optional).toBe(false);
		expect(parseValueToken("x|optional:off")?.optional).toBe(false);
	});

	it("lets the keyed form override the bare flag", () => {
		expect(parseValueToken("x|optional|optional:false")?.optional).toBe(
			false,
		);
	});

	it("works on option-list tokens, including with custom", () => {
		const list = parseValueToken("low,med,high|optional");
		expect(list?.optional).toBe(true);
		expect(list?.hasOptions).toBe(true);
		expect(list?.suggestedValues).toEqual(["low", "med", "high"]);

		const withCustom = parseValueToken("low,med,high|custom|optional");
		expect(withCustom?.optional).toBe(true);
		expect(withCustom?.allowCustomInput).toBe(true);
	});

	it("does not participate in the variable key", () => {
		expect(parseValueToken("note|optional")?.variableKey).toBe(
			parseValueToken("note")?.variableKey,
		);
	});

	it("flows through anonymous VALUE options", () => {
		expect(parseAnonymousValueOptions("|optional").optional).toBe(true);
		const withDefault = parseAnonymousValueOptions("|My default|optional");
		expect(withDefault.optional).toBe(true);
		expect(withDefault.defaultValue).toBe("My default");
		expect(parseAnonymousValueOptions("|My default").optional).toBe(false);
	});

	it("keeps shorthand defaults when combined with trim", () => {
		const parsed = parseValueToken("x|tomorrow|trim");
		expect(parsed?.trim).toBe(true);
		expect(parsed?.defaultValue).toBe("tomorrow");

		const anonymous = parseAnonymousValueOptions("|My default|trim");
		expect(anonymous.trim).toBe(true);
		expect(anonymous.defaultValue).toBe("My default");
	});
});

describe("keyed optional form interaction with shorthand defaults", () => {
	it("drops shorthand defaults next to keyed optional:true (keyed options rule)", () => {
		// Unlike the bare flag, the keyed form counts toward usesOptions,
		// so shorthand defaults are ignored — use |default: alongside it.
		const parsed = parseValueToken("x|tomorrow|optional:true");
		expect(parsed?.optional).toBe(true);
		expect(parsed?.defaultValue).toBe("");
	});

	it("treats optional:0 as false (parseBooleanFlag parity with custom)", () => {
		expect(parseValueToken("x|optional:0")?.optional).toBe(false);
	});
});
