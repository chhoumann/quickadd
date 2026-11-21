import { describe, expect, it } from "vitest";
import { isChoiceLike } from "../../utils/choiceUtils";
import {
	isCaptureChoice,
	isMacroChoice,
	isMultiChoice,
	isTemplateChoice,
} from "./choiceGuards";

const guards = [
	{ guard: isTemplateChoice, type: "Template" },
	{ guard: isCaptureChoice, type: "Capture" },
	{ guard: isMacroChoice, type: "Macro" },
	{ guard: isMultiChoice, type: "Multi" },
];

// A hole in a data.json choice list: a bad hand-edit or a truncated write.
const holes: unknown[] = [null, undefined, "Template", 7, true];

describe("choice guards", () => {
	it.each(guards)("$type guard matches only its own type", ({ guard, type }) => {
		for (const other of guards) {
			expect(guard({ id: "1", name: "x", type: other.type })).toBe(
				other.type === type,
			);
		}
	});

	it.each(guards)("$type guard rejects list holes instead of throwing", ({ guard }) => {
		for (const hole of holes) expect(guard(hole)).toBe(false);
	});

	it.each(guards)("$type guard rejects an array carrying a type", ({ guard, type }) => {
		expect(guard(Object.assign([], { type }))).toBe(false);
	});
});

describe("isChoiceLike", () => {
	it("accepts a plain object and rejects holes and arrays", () => {
		expect(isChoiceLike({ id: "1", type: "Template" })).toBe(true);
		for (const hole of holes) expect(isChoiceLike(hole)).toBe(false);
		expect(isChoiceLike([{ id: "1", type: "Template" }])).toBe(false);
	});
});
