import { describe, expect, it } from "vitest";
import { TEMPLATE_REGEX } from "../constants";
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

	it("normalizes paths the way the formatter resolves them", () => {
		const content =
			"{{TEMPLATE: /Templates/X.md}}{{TEMPLATE:Templates/X.md}}{{TEMPLATE:///Y.base}}";
		expect(Array.from(collectTemplateIncludePaths(content))).toEqual([
			"Templates/X.md",
			"Y.base",
		]);
	});

	// The hand-written scanner must never disagree with the formatter's regex
	// about which tokens exist; these inputs cover every branch of the regex.
	const PARITY_CORPUS = [
		"{{TEMPLATE:a.md}}",
		"{{TEMPLATE:a.md}}}",
		"{{TEMPLATE:a.md}}{{TEMPLATE:b.canvas}}",
		"{{TEMPLATE:}}",
		"{{TEMPLATE:.md}}",
		"{{TEMPLATE:a.md}",
		"{{TEMPLATE:a.md\n}}",
		"{{TEMPLATE:a.txt}}",
		"{{TEMPLATE:a.md.bak}}",
		"{{template:A.MD}} {{Template:b.Base}}",
		"{{TEMPLATE:{{TEMPLATE:x.md}}",
		"{{TEMPLATE:x{{TEMPLATE:y.md}}",
		"{{TEMPLATE:a.md} {{TEMPLATE:b.md}}",
		"{{TEMPLATE:a}}{{TEMPLATE:b.md}}",
		"{{TEMPLATE: /spaced.md}}",
		"{{TEMPLATE:trailing.md }}",
		"no tokens {{VALUE}} {{MACRO:x}}",
		"{{TEMPLATE:a.md}}\r\n{{TEMPLATE:b.md}}\r{{TEMPLATE:c.md}}",
	];

	it.each(PARITY_CORPUS)("matches TEMPLATE_REGEX on %j", (content) => {
		const expected = new Set<string>();
		const re = new RegExp(TEMPLATE_REGEX.source, "gi");
		let match: RegExpExecArray | null;
		while ((match = re.exec(content)) !== null) {
			const path = match[1]?.trim().replace(/^\/+/, "");
			if (path) expected.add(path);
		}
		expect(collectTemplateIncludePaths(content)).toEqual(expected);
	});

	it("scans a crafted line of unterminated prefixes in linear time", () => {
		// 20 000 prefixes take ~5 s with a global regex retrying each one.
		const content = "{{TEMPLATE:".repeat(20_000) + "x.md";
		const started = performance.now();
		expect(collectTemplateIncludePaths(content).size).toBe(0);
		expect(performance.now() - started).toBeLessThan(500);
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

	it("rewrites a token whose path is written with a leading slash or padding", () => {
		const overrides = new Map([["t/a.md", "u/a.md"]]);
		expect(
			rewriteTemplateIncludes("x {{TEMPLATE: /t/a.md}} y", overrides),
		).toBe("x {{TEMPLATE:u/a.md}} y");
	});

	it("returns the same string when there is nothing to rewrite", () => {
		const content = "plain {{VALUE}} text";
		expect(rewriteTemplateIncludes(content, new Map())).toBe(content);
		expect(rewriteTemplateIncludes(content, new Map([["x.md", "y.md"]]))).toBe(content);
	});
});
