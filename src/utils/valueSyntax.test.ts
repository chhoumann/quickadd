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
