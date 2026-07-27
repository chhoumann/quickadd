import { describe, expect, it } from "vitest";
import { SHADOW_PLACEHOLDER_ITEM_ID } from "svelte-dnd-action";
import { baseDndOptions, replaceById, stripShadow } from "./dndReorder";

const item = (id: string, extra: Record<string, unknown> = {}) => ({ id, ...extra });

describe("stripShadow", () => {
	it("removes the shadow placeholder item, preserving order", () => {
		const input = [item("a"), item(SHADOW_PLACEHOLDER_ITEM_ID), item("b")];
		expect(stripShadow(input).map((i) => i.id)).toEqual(["a", "b"]);
	});

	it("preserves order AND count when no placeholder is present (no-vanish guard)", () => {
		const input = [item("a"), item("b"), item("c")];
		const out = stripShadow(input);
		expect(out.map((i) => i.id)).toEqual(["a", "b", "c"]);
		expect(out).toHaveLength(input.length);
	});

	it("returns a NEW array without mutating the input", () => {
		const input = [item("a"), item("b")];
		const out = stripShadow(input);
		expect(out).not.toBe(input);
		expect(input).toHaveLength(2);
	});

	it("handles an empty array", () => {
		expect(stripShadow([])).toEqual([]);
	});

	it("returns empty when every item is a placeholder", () => {
		const input = [item(SHADOW_PLACEHOLDER_ITEM_ID), item(SHADOW_PLACEHOLDER_ITEM_ID)];
		expect(stripShadow(input)).toEqual([]);
	});
});

describe("replaceById", () => {
	it("replaces the matching item immutably, preserving order", () => {
		const a = item("a", { v: 1 });
		const b = item("b", { v: 2 });
		const c = item("c", { v: 3 });
		const next = item("b", { v: 99 });
		const out = replaceById([a, b, c], next);
		expect(out.map((i) => (i as { v?: number }).v)).toEqual([1, 99, 3]);
		expect(out[1]).toBe(next);
	});

	it("returns a NEW array and does not mutate the input", () => {
		const input = [item("a"), item("b")];
		const out = replaceById(input, item("a", { v: 1 }));
		expect(out).not.toBe(input);
		expect((input[0] as { v?: number }).v).toBeUndefined();
	});

	it("leaves contents unchanged when no id matches", () => {
		const input = [item("a"), item("b")];
		const out = replaceById(input, item("z", { v: 1 }));
		expect(out.map((i) => i.id)).toEqual(["a", "b"]);
	});
});

describe("baseDndOptions", () => {
	it("keeps the coupled pill options together", () => {
		// These four move as a set (see the doc comment): breaking one silently
		// makes the custom drag pill fight the library's own clone.
		const options = baseDndOptions({ items: [], dragDisabled: false });

		expect(options.morphDisabled).toBe(true);
		expect(options.useCursorForDetection).toBe(true);
		expect(options.centreDraggedOnCursor).toBe(false);
		expect(options.autoAriaDisabled).toBe(true);
	});
});
