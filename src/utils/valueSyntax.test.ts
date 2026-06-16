import { describe, expect, it, vi, afterEach } from "vitest";
import {
	buildValueVariableKey,
	parseAnonymousValueOptions,
	parseValueToken,
	resolveExistingVariableKey,
} from "./valueSyntax";

describe("parseValueToken", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("ignores empty label values", () => {
		const parsed = parseValueToken("title|label:");
		expect(parsed).not.toBeNull();
		expect(parsed?.label).toBeUndefined();
		expect(parsed?.variableKey).toBe("title");
	});

	it("uses the last label when multiple are provided", () => {
		const parsed = parseValueToken("title|label:First|label:Second");
		expect(parsed?.label).toBe("Second");
	});

	it("scopes list variables by label", () => {
		const parsed = parseValueToken("a,b|label:Priority");
		expect(parsed?.hasOptions).toBe(true);
		const expectedKey = buildValueVariableKey("a,b", "Priority", true);
		expect(parsed?.variableKey).toBe(expectedKey);
	});

	it("treats bare label option as legacy default", () => {
		const parsed = parseValueToken("title|label");
		expect(parsed?.label).toBeUndefined();
		expect(parsed?.defaultValue).toBe("label");
	});

	it("parses case style without treating it as legacy default", () => {
		const parsed = parseValueToken("title|case:kebab");
		expect(parsed?.caseStyle).toBe("kebab");
		expect(parsed?.defaultValue).toBe("");
	});

	it("parses title case style", () => {
		const parsed = parseValueToken("title|case:title");
		expect(parsed?.caseStyle).toBe("title");
	});

	it("parses custom boolean values", () => {
		expect(parseValueToken("a,b|custom:")?.allowCustomInput).toBe(true);
		expect(parseValueToken("a,b|custom:false")?.allowCustomInput).toBe(false);
		expect(parseValueToken("a,b|custom:0")?.allowCustomInput).toBe(false);
	});

	it("parses text mappings for option lists", () => {
		const parsed = parseValueToken("a,b|text:Alpha,Beta");
		expect(parsed?.suggestedValues).toEqual(["a", "b"]);
		expect(parsed?.displayValues).toEqual(["Alpha", "Beta"]);
	});

	it("allows custom plus explicit default", () => {
		const parsed = parseValueToken("a,b|custom|default:High");
		expect(parsed?.allowCustomInput).toBe(true);
		expect(parsed?.defaultValue).toBe("High");
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

	it("parses multiline type with label and default", () => {
		const parsed = parseValueToken(
			"Body|type:multiline|label:Notes|default:Hello",
		);
		expect(parsed?.variableName).toBe("Body");
		expect(parsed?.inputTypeOverride).toBe("multiline");
		expect(parsed?.label).toBe("Notes");
		expect(parsed?.defaultValue).toBe("Hello");
	});

	it("ignores shorthand default when type is present", () => {
		const parsed = parseValueToken("Body|Hello|type:multiline");
		expect(parsed?.defaultValue).toBe("");
		expect(parsed?.inputTypeOverride).toBe("multiline");
	});

	it("warns and ignores unknown type values", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const parsed = parseValueToken("Body|type:wide");
		expect(parsed?.inputTypeOverride).toBeUndefined();
		expect(warnSpy).toHaveBeenCalled();
	});

	it("warns and ignores type for option lists", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const parsed = parseValueToken("Red,Green|type:multiline");
		expect(parsed?.inputTypeOverride).toBeUndefined();
		expect(warnSpy).toHaveBeenCalled();
	});

	it("parses type:number / checkbox / text without warning", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
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

	it("treats type:boolean as an alias for checkbox", () => {
		expect(parseValueToken("Done|type:boolean")?.inputTypeOverride).toBe(
			"checkbox",
		);
	});

	it("still rejects an unknown type and names the new supported set", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		expect(parseValueToken("Body|type:wide")?.inputTypeOverride).toBeUndefined();
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("multiline, number, checkbox, text"),
		);
	});

	it("ignores a scalar type on an option-list token", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		expect(
			parseValueToken("Red,Green|type:number")?.inputTypeOverride,
		).toBeUndefined();
		expect(warnSpy).toHaveBeenCalled();
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

	it("parses case style for unnamed VALUE tokens", () => {
		const parsed = parseAnonymousValueOptions(
			"|case:kebab|label:Notes|default:Hello",
		);
		expect(parsed.caseStyle).toBe("kebab");
		expect(parsed.label).toBe("Notes");
		expect(parsed.defaultValue).toBe("Hello");
	});

	it("warns and ignores unknown type for unnamed VALUE tokens", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
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

	it("keys an option list on the explicit name and exposes aliasName", () => {
		const parsed = parseValueToken("work,home,errand|name:category");
		expect(parsed?.hasOptions).toBe(true);
		expect(parsed?.aliasName).toBe("category");
		expect(parsed?.variableKey).toBe("category");
		expect(parsed?.suggestedValues).toEqual(["work", "home", "errand"]);
	});

	it("bypasses label scoping when a name is given", () => {
		const parsed = parseValueToken("a,b|name:category|label:Pick");
		expect(parsed?.variableKey).toBe("category");
		expect(parsed?.label).toBe("Pick");
	});

	it("coexists with text and custom options", () => {
		const parsed = parseValueToken(
			"a,b|name:category|text:Alpha,Beta|custom",
		);
		expect(parsed?.aliasName).toBe("category");
		expect(parsed?.variableKey).toBe("category");
		expect(parsed?.displayValues).toEqual(["Alpha", "Beta"]);
		expect(parsed?.allowCustomInput).toBe(true);
	});

	it("warns and ignores reserved names", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const parsed = parseValueToken("a,b|name:title");
		expect(parsed?.aliasName).toBeUndefined();
		// Falls back to the option-list key (no alias).
		expect(parsed?.variableKey).toBe("a,b");
		expect(warnSpy).toHaveBeenCalled();
	});

	it("warns and ignores a name containing the reserved key delimiter", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const parsed = parseValueToken("a,b|name:foo\u001Fbar")
		expect(parsed?.aliasName).toBeUndefined();
		expect(parsed?.variableKey).toBe("a,b");
		expect(warnSpy).toHaveBeenCalled();
	});

	it("stays silent when parsed in quiet mode", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		// Reserved name would normally warn; quiet mode (the pre-pass) suppresses it.
		const parsed = parseValueToken("a,b|name:title", { quiet: true });
		expect(parsed?.aliasName).toBeUndefined();
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it("warns and ignores an empty name", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const parsed = parseValueToken("a,b|name:");
		expect(parsed?.aliasName).toBeUndefined();
		expect(parsed?.variableKey).toBe("a,b");
		expect(warnSpy).toHaveBeenCalled();
	});

	it("honors but warns about name on a single value", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
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
	it("recognizes a bare optional flag on a single-variable token", () => {
		const parsed = parseValueToken("reminder|optional");
		expect(parsed?.optional).toBe(true);
		expect(parsed?.defaultValue).toBe("");
		expect(parsed?.variableKey).toBe("reminder");
	});

	it("is case-insensitive and trims whitespace", () => {
		expect(parseValueToken("reminder| Optional ")?.optional).toBe(true);
		expect(parseValueToken("reminder|OPTIONAL")?.optional).toBe(true);
	});

	it("preserves a shorthand default sitting next to the flag", () => {
		const parsed = parseValueToken("reminder|call mom|optional");
		expect(parsed?.optional).toBe(true);
		expect(parsed?.defaultValue).toBe("call mom");
	});

	it("joins remaining shorthand parts when the flag sits between them", () => {
		// Documented compat note: 'a|optional|b' loses the literal 'optional' part.
		const parsed = parseValueToken("x|a|optional|b");
		expect(parsed?.optional).toBe(true);
		expect(parsed?.defaultValue).toBe("a|b");
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

	it("keeps a literal default of 'optional' reachable via default:", () => {
		const parsed = parseValueToken("x|default:optional");
		expect(parsed?.optional).toBe(false);
		expect(parsed?.defaultValue).toBe("optional");
	});

	it("combines with keyed options without dropping them", () => {
		const parsed = parseValueToken("x|label:Why|optional");
		expect(parsed?.optional).toBe(true);
		expect(parsed?.label).toBe("Why");
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
