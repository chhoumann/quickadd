import { describe, expect, it } from "vitest";
import { isUnreadableChoiceList } from "./choiceUtils";
import { isUnreadableCommandList } from "./macroUtils";
import {
	MALFORMED_CHILDREN_SHAPES,
	MALFORMED_COMMANDS_SHAPES,
} from "./malformedChoices.fixture";

/**
 * `isUnreadableChoiceList` and `isUnreadableCommandList` ask the same question of
 * two different containers, and four user-facing surfaces read one or the other:
 * the folder hint and the folder's drop target read the choice one, the macro
 * builder's card and its suppressed controls read the command one, and the delete
 * confirmation reads BOTH (#1612). They are deliberately siblings rather than one
 * shared function - the repo's existing shape for this pair (`isChoiceLike` /
 * `isCommandLike`, `hasChildChoices` / `hasCommandList`) - so this test is what
 * buys the "they cannot disagree" claim their doc comments make.
 *
 * #1611 was exactly this drift: the choice-side predicate documented the rule the
 * command-side one implements, and returned `true` for `""` / `0` / `false`.
 */

const EVERY_SHAPE: { key: string; value: unknown; lossy: boolean }[] = [
	...MALFORMED_CHILDREN_SHAPES,
	...MALFORMED_COMMANDS_SHAPES,
	// Values neither list carries, because they are not a container shape either
	// type produces - but the predicates still have to agree about them.
	{ key: "emptyArray", value: [], lossy: false },
	{ key: "nonEmptyArray", value: [{ id: "a" }], lossy: false },
	{ key: "NaN", value: Number.NaN, lossy: false },
	{ key: "negativeZero", value: -0, lossy: false },
	{ key: "true", value: true, lossy: true },
	{ key: "whitespaceString", value: " ", lossy: true },
	{ key: "objectWithProto", value: Object.create(null) as object, lossy: false },
];

describe("the two unreadable-container predicates", () => {
	it("answer identically for every shape either container shows up in", () => {
		for (const shape of EVERY_SHAPE) {
			expect(
				isUnreadableChoiceList(shape.value),
				`choice side: ${shape.key}`,
			).toBe(isUnreadableCommandList(shape.value));
		}
	});

	it("answer what the shared fixture says is lossy", () => {
		for (const shape of EVERY_SHAPE) {
			expect(isUnreadableChoiceList(shape.value), shape.key).toBe(shape.lossy);
		}
	});

	it("is false for an array, which is always readable however wrong its entries", () => {
		// The line the whole cluster rests on: a real array is READABLE even when it
		// cannot be rendered. Unrenderable entries are repaired at the editor seam
		// (#1593, #1608); only a non-array container is "we cannot read this".
		expect(isUnreadableChoiceList([null, "stray", { name: "no id" }])).toBe(false);
		expect(isUnreadableCommandList([null, "stray", { name: "no id" }])).toBe(false);
	});
});
