import { describe, expect, it } from "vitest";
import { extractScriptFromMarkdown } from "./extractScriptFromMarkdown";

/**
 * Strip the line-number-preserving leading newlines and the single structural
 * trailing newline (the terminator of the last body line) so assertions read
 * cleanly. Byte-exact preservation is asserted separately in the CRLF test.
 */
function body(content: string): string | null {
	const { code } = extractScriptFromMarkdown(content);
	return code === null ? null : code.replace(/^\n+/, "").replace(/\r?\n$/, "");
}

describe("extractScriptFromMarkdown", () => {
	it("returns null when there is no code fence", () => {
		const res = extractScriptFromMarkdown("Just some prose.\n\nNo code here.");
		expect(res.code).toBeNull();
		expect(res.error).toMatch(/no .*code block/i);
	});

	it("returns null when the only fence is not JavaScript", () => {
		const res = extractScriptFromMarkdown("```python\nprint('hi')\n```\n");
		expect(res.code).toBeNull();
	});

	it("extracts a single ```js block and ignores surrounding prose", () => {
		const content = [
			"# Title",
			"",
			"Some notes before.",
			"",
			"```js",
			'module.exports = () => "hi";',
			"```",
			"",
			"Notes after.",
		].join("\n");
		expect(body(content)).toBe('module.exports = () => "hi";');
	});

	it("matches ```javascript (case-insensitive) and ignores trailing info tokens", () => {
		expect(body("```JavaScript foo bar\nconst a = 1;\n```")).toBe("const a = 1;");
		expect(body("```JS\nconst b = 2;\n```")).toBe("const b = 2;");
	});

	it("does not match look-alike languages (jsx/json/typescript)", () => {
		expect(extractScriptFromMarkdown("```jsx\nx\n```").code).toBeNull();
		expect(extractScriptFromMarkdown("```json\n{}\n```").code).toBeNull();
		expect(extractScriptFromMarkdown("```typescript\nx\n```").code).toBeNull();
	});

	it("runs the FIRST js block when several exist", () => {
		const content = [
			"```js",
			"const first = 1;",
			"```",
			"",
			"```js",
			"const second = 2;",
			"```",
		].join("\n");
		expect(body(content)).toBe("const first = 1;");
	});

	it("does not close on a line with trailing content after the backticks", () => {
		const content = [
			"```js",
			'const fence = "```";',
			'module.exports = () => fence;',
			"```",
		].join("\n");
		expect(body(content)).toBe(
			'const fence = "```";\nmodule.exports = () => fence;',
		);
	});

	it("a bare same-length fence inside the body DOES close it (documented)", () => {
		const content = ["```js", "const a = 1;", "```", "const ignored = 2;"].join(
			"\n",
		);
		expect(body(content)).toBe("const a = 1;");
	});

	it("lets a 4-backtick wrapper embed a bare 3-backtick line", () => {
		const content = [
			"````js",
			"const md = `",
			"```",
			"`;",
			"````",
		].join("\n");
		expect(body(content)).toBe("const md = `\n```\n`;");
	});

	it("reports an empty fence distinctly from a missing fence", () => {
		const empty = extractScriptFromMarkdown("```js\n\n```");
		expect(empty.code).toBe("");
		expect(empty.error).toMatch(/empty/i);

		const whitespace = extractScriptFromMarkdown("```js\n   \n\t\n```");
		expect(whitespace.code).toBe("");
		expect(whitespace.error).toMatch(/empty/i);
	});

	it("preserves CRLF line endings inside the body byte-for-byte", () => {
		const content = "```js\r\nconst a = `x\r\ny`;\r\n```\r\n";
		const { code } = extractScriptFromMarkdown(content);
		expect(code).not.toBeNull();
		expect((code as string).replace(/^\n+/, "")).toBe("const a = `x\r\ny`;\r\n");
	});

	it("ignores YAML frontmatter before the fence", () => {
		const content = [
			"---",
			"title: My Script",
			"---",
			"",
			"```js",
			"const a = 1;",
			"```",
		].join("\n");
		expect(body(content)).toBe("const a = 1;");
	});

	it("handles an indented opening fence (<=3 spaces)", () => {
		expect(body("   ```js\n   const a = 1;\n   ```")).toBe("   const a = 1;");
	});

	it("does not treat a callout/blockquote fence as a script (out of scope)", () => {
		const content = ["> ```js", "> const a = 1;", "> ```"].join("\n");
		expect(extractScriptFromMarkdown(content).code).toBeNull();
	});

	it("preserves note line numbers via leading blank-line padding", () => {
		const content = [
			"# Heading", // line 1
			"prose", // line 2
			"```js", // line 3
			"throw new Error('x');", // line 4 in the note
			"```",
		].join("\n");
		const { code } = extractScriptFromMarkdown(content);
		// Body starts after 3 preceding lines -> 3 leading newlines, so the throw is
		// on source line 4, matching the note. The trailing newline is the body
		// line's own terminator (preserved byte-for-byte).
		expect(code).toBe("\n\n\nthrow new Error('x');\n");
	});

	it("tolerates an unclosed fence by taking the rest of the note", () => {
		expect(body("```js\nconst a = 1;\nconst b = 2;")).toBe(
			"const a = 1;\nconst b = 2;",
		);
	});
});
