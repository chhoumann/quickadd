import { describe, expect, it } from "vitest";
import { parseMacroToken } from "./macroSyntax";

describe("parseMacroToken", () => {
	it("returns null for empty input", () => {
		expect(parseMacroToken("")).toBeNull();
	});

	it("parses shorthand labels", () => {
		const parsed = parseMacroToken("MyMacro|Pick one");
		expect(parsed).toEqual({ macroName: "MyMacro", label: "Pick one" });
	});

	it("parses label option", () => {
		const parsed = parseMacroToken("MyMacro|label:Pick one");
		expect(parsed).toEqual({ macroName: "MyMacro", label: "Pick one" });
	});

	it("ignores empty label option", () => {
		const parsed = parseMacroToken("MyMacro|label:");
		expect(parsed).toEqual({ macroName: "MyMacro", label: undefined });
	});
});
