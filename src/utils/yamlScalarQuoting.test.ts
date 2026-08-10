import { describe, expect, it } from "vitest";
import {
	escapeValueInsideQuotedYamlScalar,
	quoteYamlDouble,
	shouldQuoteTextScalar,
} from "./yamlScalarQuoting";

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

	it("escapes the remaining C0/DEL control characters as \\xNN", () => {
		expect(quoteYamlDouble("a\x00b")).toBe('"a\\x00b"');
		expect(quoteYamlDouble("a\bb")).toBe('"a\\x08b"');
		expect(quoteYamlDouble("a\fb")).toBe('"a\\x0cb"');
		expect(quoteYamlDouble("a\x1bb")).toBe('"a\\x1bb"');
		expect(quoteYamlDouble("a\x7fb")).toBe('"a\\x7fb"');
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

describe("escapeValueInsideQuotedYamlScalar", () => {
	/** Helper: locate the token and escape `value` for that position. */
	function escape(input: string, value: string): string {
		const start = input.indexOf(TOKEN);
		return escapeValueInsideQuotedYamlScalar(
			input,
			start,
			start + TOKEN.length,
			value,
		);
	}

	it("escapes double quotes, backslashes, and control chars inside a double-quoted scalar", () => {
		const input = `---\ntitle: "${TOKEN}"\n---\nbody`;
		expect(escape(input, 'My "Great" Note')).toBe('My \\"Great\\" Note');
		expect(escape(input, "a\\b")).toBe("a\\\\b");
		expect(escape(input, "a\nb")).toBe("a\\nb");
		expect(escape(input, "a\x00b")).toBe("a\\x00b");
		expect(escape(input, "a\x1bb")).toBe("a\\x1bb");
	});

	it("doubles apostrophes inside a single-quoted scalar", () => {
		const input = `---\ntitle: '${TOKEN}'\n---\nbody`;
		expect(escape(input, "O'Brien")).toBe("O''Brien");
	});

	it("escapes inside a quoted list item", () => {
		const input = `---\ntags:\n  - "${TOKEN}"\n---\nbody`;
		expect(escape(input, 'say "hi"')).toBe('say \\"hi\\"');
	});

	it("passes through untouched when the token is not quoted", () => {
		const input = `---\ntitle: ${TOKEN}\n---\nbody`;
		expect(escape(input, 'My "Great" Note')).toBe('My "Great" Note');
	});

	it("passes through untouched when quotes wrap more than the token", () => {
		const input = `---\ntitle: "prefix ${TOKEN}"\n---\nbody`;
		expect(escape(input, 'a "b"')).toBe('a "b"');
	});

	it("passes through untouched in the note body", () => {
		const input = `---\ntitle: x\n---\nSaid "${TOKEN}" today`;
		expect(escape(input, 'a "b"')).toBe('a "b"');
	});
});
