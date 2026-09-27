import { describe, expect, it } from "vitest";
import {
	collectTemplateIncludePaths,
	rewriteTemplateIncludes,
} from "./templateIncludes";

describe("collectTemplateIncludePaths", () => {
	it("finds every distinct include, in order, case-insensitively", () => {
		const content = [
			"# MOC",
			"{{TEMPLATE:Templates/Dashboard.base}}",
			"{{template:Templates/Footer.md}}",
			"{{TEMPLATE:Templates/Dashboard.base}}",
			"{{Template:Boards/Board.canvas}}",
		].join("\n");

		expect(Array.from(collectTemplateIncludePaths(content))).toEqual([
			"Templates/Dashboard.base",
			"Templates/Footer.md",
			"Boards/Board.canvas",
		]);
	});

	it("ignores tokens the formatter would not resolve as includes", () => {
		const content =
			"{{TEMPLATE:no-extension}} {{TEMPLATE:notes/x.txt}} {{MACRO:x}} {{VALUE}}";
		expect(collectTemplateIncludePaths(content).size).toBe(0);
	});

	it("returns an empty set for empty content", () => {
		expect(collectTemplateIncludePaths("").size).toBe(0);
	});
});

describe("rewriteTemplateIncludes", () => {
	it("rewrites only the includes whose path has an override", () => {
		const overrides = new Map([
			["Templates/Dashboard.base", "My Templates/Dashboard.base"],
		]);
		const content =
			"a {{TEMPLATE:Templates/Dashboard.base}} b {{TEMPLATE:Templates/Footer.md}} c";

		expect(rewriteTemplateIncludes(content, overrides)).toBe(
			"a {{TEMPLATE:My Templates/Dashboard.base}} b {{TEMPLATE:Templates/Footer.md}} c",
		);
	});

	it("rewrites every occurrence, including lower-case tokens", () => {
		const overrides = new Map([["t/a.md", "u/a.md"]]);
		expect(
			rewriteTemplateIncludes("{{template:t/a.md}}\n{{TEMPLATE:t/a.md}}", overrides),
		).toBe("{{TEMPLATE:u/a.md}}\n{{TEMPLATE:u/a.md}}");
	});

	it("does not touch a path that merely shares a prefix with an override", () => {
		const overrides = new Map([["t/a.md", "u/a.md"]]);
		expect(rewriteTemplateIncludes("{{TEMPLATE:t/a.md.bak.md}}", overrides)).toBe(
			"{{TEMPLATE:t/a.md.bak.md}}",
		);
	});

	it("returns the same string when there is nothing to rewrite", () => {
		const content = "plain {{VALUE}} text";
		expect(rewriteTemplateIncludes(content, new Map())).toBe(content);
		expect(rewriteTemplateIncludes(content, new Map([["x.md", "y.md"]]))).toBe(content);
	});
});
