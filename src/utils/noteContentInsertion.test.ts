import { describe, expect, it } from "vitest";
import { getBodyStartOffset, insertAtNoteBodyStart } from "./noteContentInsertion";

describe("getBodyStartOffset", () => {
	it("returns 0 when there is no frontmatter", () => {
		expect(getBodyStartOffset("# Heading\nBody")).toBe(0);
	});

	it("returns the offset just after the closing fence for normal frontmatter", () => {
		const content = "---\ntitle: A\n---\n# Body";
		expect(getBodyStartOffset(content)).toBe("---\ntitle: A\n---\n".length);
	});

	it("detects empty frontmatter", () => {
		expect(getBodyStartOffset("---\n---\n# Body")).toBe("---\n---\n".length);
	});

	it("treats a non-offset-0 fence as no frontmatter", () => {
		expect(getBodyStartOffset("\n---\ntitle: A\n---\nBody")).toBe(0);
	});

	it("treats a '...'-closed block as no frontmatter (Obsidian-consistent)", () => {
		expect(getBodyStartOffset("---\ntitle: A\n...\nBody")).toBe(0);
	});
});

describe("insertAtNoteBodyStart", () => {
	it("inserts below normal frontmatter, on its own line", () => {
		expect(insertAtNoteBodyStart("---\ntitle: A\n---\n# Heading", "INSERTED")).toBe(
			"---\ntitle: A\n---\nINSERTED\n# Heading",
		);
	});

	it("inserts below empty frontmatter instead of above it (issue #647)", () => {
		expect(insertAtNoteBodyStart("---\n---\n# Body", "INSERTED")).toBe(
			"---\n---\nINSERTED\n# Body",
		);
	});

	it("keeps the closing fence intact for a frontmatter-only note with no trailing newline", () => {
		expect(insertAtNoteBodyStart("---\ntitle: A\n---", "INSERTED")).toBe(
			"---\ntitle: A\n---\nINSERTED",
		);
		expect(insertAtNoteBodyStart("---\n---", "INSERTED")).toBe("---\n---\nINSERTED");
	});

	it("inserts at the top of a note with no frontmatter without gluing", () => {
		expect(insertAtNoteBodyStart("# Heading\nBody", "INSERTED")).toBe(
			"INSERTED\n# Heading\nBody",
		);
	});

	it("does not add a separator when the payload already ends with a newline", () => {
		expect(insertAtNoteBodyStart("# Body", "- [ ] task\n")).toBe("- [ ] task\n# Body");
		expect(insertAtNoteBodyStart("---\n---", "- [ ] task\n")).toBe(
			"---\n---\n- [ ] task\n",
		);
	});

	it("absorbs an existing blank line after the fence rather than doubling it", () => {
		expect(insertAtNoteBodyStart("---\ntitle: A\n---\n\nBody", "INSERTED")).toBe(
			"---\ntitle: A\n---\nINSERTED\nBody",
		);
	});

	it("preserves CRLF frontmatter and absorbs a CRLF blank line", () => {
		expect(
			insertAtNoteBodyStart("---\r\ntitle: A\r\n---\r\n# Body\r\n", "INSERTED"),
		).toBe("---\r\ntitle: A\r\n---\r\nINSERTED\n# Body\r\n");
		expect(
			insertAtNoteBodyStart("---\r\ntitle: A\r\n---\r\n\r\nBody", "INSERTED"),
		).toBe("---\r\ntitle: A\r\n---\r\nINSERTED\r\nBody");
	});

	it("treats a CRLF-leading payload as already newline-started (no doubled blank line)", () => {
		expect(insertAtNoteBodyStart("---\n---", "\r\nCAP")).toBe("---\n---\r\nCAP");
	});

	it("handles empty content", () => {
		expect(insertAtNoteBodyStart("", "INSERTED")).toBe("INSERTED");
	});

	it("returns the note unchanged when the payload is empty", () => {
		expect(insertAtNoteBodyStart("---\na: 1\n---\nBody", "")).toBe(
			"---\na: 1\n---\nBody",
		);
	});

	it("stacks repeated top captures newest-first, below frontmatter, without gluing", () => {
		const r1 = insertAtNoteBodyStart("---\ntitle: A\n---\nBody", "A");
		expect(r1).toBe("---\ntitle: A\n---\nA\nBody");
		const r2 = insertAtNoteBodyStart(r1, "B");
		expect(r2).toBe("---\ntitle: A\n---\nB\nA\nBody");
	});

	it("keeps the fence intact for a CRLF frontmatter-only note with no trailing newline (EOF + leading separator)", () => {
		expect(insertAtNoteBodyStart("---\r\ntitle: A\r\n---", "INSERTED")).toBe(
			"---\r\ntitle: A\r\n---\nINSERTED",
		);
	});

	it("inserts on its own line for a frontmatter-only note WITH a trailing newline (empty body)", () => {
		expect(insertAtNoteBodyStart("---\ntitle: A\n---\n", "INSERTED")).toBe(
			"---\ntitle: A\n---\nINSERTED",
		);
	});
});
