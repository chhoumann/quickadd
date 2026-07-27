import { describe, expect, it } from "vitest";
import { nextCommandZoneId } from "./commandZoneId";

/**
 * #1613. Two CommandLists sharing a svelte-dnd-action zone `type` are mutually
 * valid drop targets, because the library hit-tests every zone in a type group
 * geometrically - a modal backdrop shields nothing. The conditional-branch editor
 * opens on top of the still-open macro builder, so a command dragged a little too
 * far down inside the branch editor landed in the builder underneath.
 */
describe("nextCommandZoneId", () => {
	it("never hands out the same id twice", () => {
		const ids = Array.from({ length: 50 }, () => nextCommandZoneId());
		expect(new Set(ids).size).toBe(ids.length);
	});
});
