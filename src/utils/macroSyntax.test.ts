import { describe, expect, it } from "vitest";
import { parseMacroToken } from "./macroSyntax";

describe("parseMacroToken", () => {
	it("returns null for empty input", () => {
		expect(parseMacroToken("")).toBeNull();
	});

	it("parses label option", () => {
		const parsed = parseMacroToken("MyMacro|label:Pick one");
		expect(parsed).toEqual({ macroName: "MyMacro", label: "Pick one" });
	});

	it("rejects pipe without label option", () => {
		const parsed = parseMacroToken("MyMacro|Pick one");
		expect(parsed).toBeNull();
	});

	it("ignores empty label option", () => {
		const parsed = parseMacroToken("MyMacro|label:");
		expect(parsed).toEqual({ macroName: "MyMacro", label: undefined });
	});
});
