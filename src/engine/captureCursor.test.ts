import { describe, expect, it } from "vitest";
import {
	getCaptureCursorPosition,
	getCaptureInsertion,
	mapCaptureCursorPositionFromBoundary,
} from "./captureCursor";

describe("getCaptureCursorPosition", () => {
	it("returns null when content is unchanged", () => {
		expect(getCaptureCursorPosition("unchanged", "unchanged")).toBeNull();
	});

	it("returns insertion metadata for capture placement", () => {
		const before = "Body";
		const after = "Body\nCaptured";

		expect(getCaptureInsertion(before, after)).toEqual({
			boundaryOffsetInPrevious: 4,
			cursorOffsetInNext: 5,
			cursorPositionInNext: { line: 1, ch: 0 },
		});
	});

	it("returns the inserted line when capture is appended with a leading newline", () => {
		const before = "Line one";
		const after = "Line one\nCaptured";

		expect(getCaptureCursorPosition(before, after)).toEqual({ line: 1, ch: 0 });
	});

	it("returns the inserted location for top insertion", () => {
		const before = "Body line";
		const after = "Captured\nBody line";

		expect(getCaptureCursorPosition(before, after)).toEqual({ line: 0, ch: 0 });
	});

	it("returns the inserted location for inline insertion", () => {
		const before = "## Heading\nBody";
		const after = "## Heading Captured\nBody";

		expect(getCaptureCursorPosition(before, after)).toEqual({ line: 0, ch: 10 });
	});

	it("maps cursor by insertion boundary when earlier lines were rewritten", () => {
		const previous = "Title: old\nBody";
		const next = "Title: new\nBody\nCaptured";

		expect(
			mapCaptureCursorPositionFromBoundary(previous, next, previous.length),
		).toEqual({ line: 2, ch: 0 });
	});

	it("maps zero-offset boundaries using after-context matches", () => {
		const previous = "Captured\nBody";
		const next = "Title\nCaptured\nBody";

		expect(mapCaptureCursorPositionFromBoundary(previous, next, 0)).toEqual({
			line: 1,
			ch: 0,
		});
	});
});
