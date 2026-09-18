import { describe, expect, it } from "vitest";
import { mapEditorCursorPlacement } from "./editorCursorPlacement";

describe("cursor placement through editor link insertion", () => {
	it("shifts a marker past an earlier insertion", () => {
		expect(mapEditorCursorPlacement({ content: "AB", offsets: [1] }, {
			filePath: "Note.md", before: "AB", after: "[[Note]]AB",
			edits: [{ from: 0, to: 0, text: "[[Note]]" }],
		})).toEqual({ content: "[[Note]]AB", offsets: [9] });
	});

	it("keeps a marker before a link inserted at the same point", () => {
		expect(mapEditorCursorPlacement({ content: "AB", offsets: [2] }, {
			filePath: "Note.md", before: "AB", after: "AB[[Note]]",
			edits: [{ from: 2, to: 2, text: "[[Note]]" }],
		})).toEqual({ content: "AB[[Note]]", offsets: [2] });
	});

	it("maps multiple carets through inserts in one transaction", () => {
		expect(mapEditorCursorPlacement({ content: "AB gap AB", offsets: [1, 8] }, {
			filePath: "Note.md", before: "AB gap AB", after: "AB[x] gap AB[y]",
			edits: [{ from: 9, to: 9, text: "[y]" }, { from: 2, to: 2, text: "[x]" }],
		})).toEqual({ content: "AB[x] gap AB[y]", offsets: [1, 11] });
	});

	it("accounts for a replacement before a marker", () => {
		expect(mapEditorCursorPlacement({ content: "XX AB", offsets: [4] }, {
			filePath: "Note.md", before: "XX AB", after: "link AB",
			edits: [{ from: 0, to: 2, text: "link" }],
		})).toEqual({ content: "link AB", offsets: [6] });
	});

	it("skips a replacement that erases a marker location", () => {
		expect(mapEditorCursorPlacement({ content: "AB", offsets: [1] }, {
			filePath: "Note.md", before: "AB", after: "[[Note]]",
			edits: [{ from: 0, to: 2, text: "[[Note]]" }],
		})).toBeNull();
	});

	it.each([
		{ before: "Other", after: "Other[[Note]]", edits: [{ from: 5, to: 5, text: "[[Note]]" }] },
		{ before: "AB", after: "AB[[Note]]unexpected", edits: [{ from: 2, to: 2, text: "[[Note]]" }] },
	])("skips stale or unaccounted document changes", mutation => {
		expect(mapEditorCursorPlacement({ content: "AB", offsets: [1] }, { filePath: "Note.md", ...mutation })).toBeNull();
	});
});
