import { describe, expect, it } from "vitest";
import { quoteYamlDouble, shouldQuoteTextScalar } from "./yamlScalarQuoting";

const TOKEN = "{{VALUE:x}}";

/** Helper: locate the token in `input` and ask whether it should be quoted. */
function check(input: string): boolean {
	const start = input.indexOf(TOKEN);
	return shouldQuoteTextScalar(input, start, start + TOKEN.length);
}

describe("quoteYamlDouble", () => {
	it("wraps a plain value in double quotes", () => {
		expect(quoteYamlDouble("0042")).toBe('"0042"');
		expect(quoteYamlDouble("#todo")).toBe('"#todo"');
	});

	it("escapes embedded double quotes and backslashes", () => {
		expect(quoteYamlDouble('he said "hi"')).toBe('"he said \\"hi\\""');
		expect(quoteYamlDouble("a\\b")).toBe('"a\\\\b"');
	});

	it("escapes control characters so a seeded value stays valid YAML", () => {
		expect(quoteYamlDouble("a\nb")).toBe('"a\\nb"');
		expect(quoteYamlDouble("a\tb")).toBe('"a\\tb"');
	});
});

describe("shouldQuoteTextScalar", () => {
	it("quotes a sole-value front-matter scalar", () => {
		expect(check(`---\nid: ${TOKEN}\n---\nbody`)).toBe(true);
	});

	it("quotes a sole-value list item", () => {
		expect(check(`---\ntags:\n  - ${TOKEN}\n---\nbody`)).toBe(true);
	});

	it("does NOT quote when the token is only part of the value", () => {
		expect(check(`---\nid: prefix-${TOKEN}\n---`)).toBe(false);
		expect(check(`---\nid: ${TOKEN} suffix\n---`)).toBe(false);
	});

	it("does NOT quote an already author-quoted value", () => {
		expect(check(`---\nid: "${TOKEN}"\n---`)).toBe(false);
	});

	it("quotes a sole value followed only by a trailing YAML comment", () => {
		expect(check(`---\nid: ${TOKEN} # keep\n---`)).toBe(true);
		// but not when real content follows the token
		expect(check(`---\nid: ${TOKEN} more # c\n---`)).toBe(false);
	});

	it("does NOT quote in the note body (outside front matter)", () => {
		expect(check(`---\ntitle: x\n---\nSome ${TOKEN} prose`)).toBe(false);
		expect(check(`No front matter here ${TOKEN}`)).toBe(false);
	});
});
