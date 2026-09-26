import { describe, expect, it } from "vitest";
import { prepareTemplateContent, rebaseTemplateCursor } from "./templateCursorPlacement";

describe("prepareTemplateContent", () => {
	it("uses the first body marker and strips every marker case-insensitively", () => {
		expect(prepareTemplateContent("😀before{{cursor}}after{{CURSOR}}end")).toEqual({
			content: "😀beforeafterend", offsets: [8],
		});
	});

	it("strips YAML markers without using them for placement", () => {
		expect(prepareTemplateContent('---\nlabel: "a{{CURSOR}}b"\n---\nA{{cursor}}B')).toEqual({
			content: '---\nlabel: "ab"\n---\nAB',
			offsets: ['---\nlabel: "ab"\n---\nA'.length],
		});
	});

	it.each(["", "unmarked", '---\nlabel: "{{CURSOR}}"\n---\nbody'])(
		"does not invent placement for %j", input => {
			expect(prepareTemplateContent(input).offsets).toEqual([]);
		},
	);

	it.each([
		["{{CURSOR}}", "", 0],
		[" \t{{cursor}}\n", " \t\n", 2],
	])("keeps placement in empty or whitespace output %j", (input, content, offset) => {
		expect(prepareTemplateContent(input)).toEqual({ content, offsets: [offset] });
	});
});

describe("rebaseTemplateCursor", () => {
	it("rebases multiple offsets after frontmatter grows while body bytes stay equal", () => {
		const before = "---\ntag: a\n---\n\n😀body\nend";
		const after = "---\ntag:\n  - a\n  - b\nstatus: draft\n---\n\n😀body\nend";
		expect(rebaseTemplateCursor({ content: before, offsets: [before.indexOf("body"), before.length] }, after)).toEqual({
			content: after, offsets: [after.indexOf("body"), after.length],
		});
	});

	it("rebases frontmatter creation and removal", () => {
		const content = "beforeafter";
		const withFrontmatter = "---\ntags: []\n---\n" + content;
		expect(rebaseTemplateCursor({ content, offsets: [6] }, withFrontmatter)?.offsets).toEqual([withFrontmatter.length - 5]);
		expect(rebaseTemplateCursor({ content: withFrontmatter, offsets: [withFrontmatter.length - 5] }, content)?.offsets).toEqual([6]);
	});

	it("retains an unchanged snapshot", () => {
		const cursor = { content: "body", offsets: [2] };
		expect(rebaseTemplateCursor(cursor, "body")).toBe(cursor);
	});

	it.each(["---\nx: 1\n---\nchanged body", "---\nx: 1\n---\n body", "---\nx: 1\n---\nbody\n"])(
		"rejects body changes even when the old text can be found: %j", after => {
			expect(rebaseTemplateCursor({ content: "body", offsets: [2] }, after)).toBeNull();
		},
	);

	it("rejects a cursor inside rewritten frontmatter", () => {
		expect(rebaseTemplateCursor({ content: "---\nx: a\n---\nbody", offsets: [5] }, "---\nx: abc\n---\nbody")).toBeNull();
	});

	it("maps CRLF offsets onto the same note saved with LF line endings", () => {
		const cursor = { content: "a\r\nFirst\r\nBeforeafter", offsets: ["a\r\nFirst\r\nBefore".length] };
		expect(rebaseTemplateCursor(cursor, "a\nFirst\nBeforeafter")).toEqual({
			content: "a\nFirst\nBeforeafter", offsets: ["a\nFirst\nBefore".length],
		});
	});

	it("maps CRLF offsets when the LF note's front matter also changed", () => {
		const cursor = { content: "---\r\na: 1\r\n---\r\nFirst\r\nBeforeafter", offsets: ["---\r\na: 1\r\n---\r\nFirst\r\nBefore".length] };
		const content = "---\na: 1\nb: 2\n---\nFirst\nBeforeafter";
		expect(rebaseTemplateCursor(cursor, content)).toEqual({ content, offsets: [content.indexOf("after")] });
	});
});
