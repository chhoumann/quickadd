import { describe, expect, it } from "vitest";
import {
	getBodyStartOffset,
	insertAtNoteBodyStart,
	insertAtNoteBodyStartWithResult,
} from "./noteContentInsertion";

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

	it("keeps the blank line that separates frontmatter from the body (issue #1538)", () => {
		expect(insertAtNoteBodyStart("---\ntitle: A\n---\n\nBody", "INSERTED")).toBe(
			"---\ntitle: A\n---\n\nINSERTED\nBody",
		);
	});

	it("reproduces issue #1538 verbatim", () => {
		expect(
			insertAtNoteBodyStart(
				"---\ndate: 2026-07-25\n---\n\n## Log\n\n## Tasks\n",
				"Call the dentist",
			),
		).toBe("---\ndate: 2026-07-25\n---\n\nCall the dentist\n## Log\n\n## Tasks\n");
	});

	it("preserves CRLF frontmatter and its CRLF separator line", () => {
		expect(
			insertAtNoteBodyStart("---\r\ntitle: A\r\n---\r\n# Body\r\n", "INSERTED"),
		).toBe("---\r\ntitle: A\r\n---\r\nINSERTED\n# Body\r\n");
		// The separator's own \r\n survives verbatim; only QuickAdd's injected
		// terminator is a lone \n (the house convention for every insert helper).
		expect(
			insertAtNoteBodyStart("---\r\ntitle: A\r\n---\r\n\r\nBody", "INSERTED"),
		).toBe("---\r\ntitle: A\r\n---\r\n\r\nINSERTED\nBody");
	});

	it("treats only ONE blank line as the frontmatter separator", () => {
		expect(insertAtNoteBodyStart("---\na: 1\n---\n\n\n## Log", "CAP")).toBe(
			"---\na: 1\n---\n\nCAP\n\n## Log",
		);
	});

	it("skips a whitespace-only separator line without rewriting its bytes", () => {
		expect(insertAtNoteBodyStart("---\na: 1\n---\n   \n## Log\n", "CAP")).toBe(
			"---\na: 1\n---\n   \nCAP\n## Log\n",
		);
	});

	it("handles a separator line that is the last line of the note", () => {
		expect(insertAtNoteBodyStart("---\na: 1\n---\n\n", "CAP")).toBe(
			"---\na: 1\n---\n\nCAP",
		);
	});

	it("does not skip the separator when the payload brings its own leading blank line", () => {
		// Otherwise the payload's newline and the note's separator would stack two
		// blank lines. The first case is byte-identical to pre-#1538 output; the
		// second still gains the trailing terminator, which is what stops the
		// payload from swallowing the separator line.
		expect(insertAtNoteBodyStart("---\na: 1\n---\n\nExisting", "\nContent\n")).toBe(
			"---\na: 1\n---\n\nContent\n\nExisting",
		);
		expect(insertAtNoteBodyStart("---\na: 1\n---\n\n## Log", "\n- x")).toBe(
			"---\na: 1\n---\n\n- x\n\n## Log",
		);
	});

	it("counts a whitespace-only leading payload line as the payload's own blank line", () => {
		// Same blank-line definition on both sides, so a template whose separator
		// carries trailing spaces does not stack two blanks above the insert.
		expect(insertAtNoteBodyStart("---\na: 1\n---\n\nBody", "   \nContent")).toBe(
			"---\na: 1\n---\n   \nContent\n\nBody",
		);
		// ...but the payload still gets a leading separator when its first line has
		// visible content, so it can never glue onto the closing fence.
		expect(insertAtNoteBodyStart("---\na: 1\n---", "   Content")).toBe(
			"---\na: 1\n---\n   Content",
		);
	});

	it("never eats a blank first line when there is no frontmatter", () => {
		expect(insertAtNoteBodyStart("\n## Log\n", "CAP")).toBe("CAP\n\n## Log\n");
		expect(insertAtNoteBodyStart("\n\n## Log\n", "CAP")).toBe("CAP\n\n\n## Log\n");
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

	it("keeps the separator line put across repeated captures (no accumulating blanks)", () => {
		const r1 = insertAtNoteBodyStart("---\na: 1\n---\n\nBody", "A");
		expect(r1).toBe("---\na: 1\n---\n\nA\nBody");
		const r2 = insertAtNoteBodyStart(r1, "B");
		expect(r2).toBe("---\na: 1\n---\n\nB\nA\nBody");
	});

	it("reports the inserted-text offsets past the skipped separator line", () => {
		const content = "---\ndate: 2026-07-25\n---\n\n## Log\n";
		const result = insertAtNoteBodyStartWithResult(content, "Call the dentist");
		expect(result.insertedStartOffset).toBe(
			"---\ndate: 2026-07-25\n---\n\n".length,
		);
		expect(
			result.content.slice(result.insertedStartOffset ?? 0, result.insertedEndOffset ?? 0),
		).toBe("Call the dentist");
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
