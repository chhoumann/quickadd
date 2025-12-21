import { describe, expect, it } from "vitest";
import {
	buildValueVariableKey,
	parseValueToken,
	resolveExistingVariableKey,
} from "./valueSyntax";

describe("parseValueToken", () => {
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

	it("parses custom boolean values", () => {
		expect(parseValueToken("a,b|custom:")?.allowCustomInput).toBe(true);
		expect(parseValueToken("a,b|custom:false")?.allowCustomInput).toBe(false);
		expect(parseValueToken("a,b|custom:0")?.allowCustomInput).toBe(false);
	});

	it("allows custom plus explicit default", () => {
		const parsed = parseValueToken("a,b|custom|default:High");
		expect(parsed?.allowCustomInput).toBe(true);
		expect(parsed?.defaultValue).toBe("High");
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
