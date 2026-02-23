import { describe, expect, it } from "vitest";
import { getCaptureCursorPosition } from "./captureCursor";

describe("getCaptureCursorPosition", () => {
	it("returns null when content is unchanged", () => {
		expect(getCaptureCursorPosition("unchanged", "unchanged")).toBeNull();
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
});
