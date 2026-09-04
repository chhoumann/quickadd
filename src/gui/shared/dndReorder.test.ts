import { describe, expect, it } from "vitest";
import { SHADOW_PLACEHOLDER_ITEM_ID } from "svelte-dnd-action";
import { applyOrder, baseDndOptions, moveById, replaceById, stripShadow } from "./dndReorder";

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

describe("applyOrder", () => {
	const ids = (items: { id: string }[]) => items.map((i) => i.id);
	const sameMultiset = (a: { id: string }[], b: { id: string }[]) => {
		expect([...ids(a)].sort()).toEqual([...ids(b)].sort());
		expect(a).toHaveLength(b.length);
	};

	it.each([
		{
			name: "keeps identity when reported matches current",
			current: ["a", "b", "c"],
			reported: ["a", "b", "c"],
			expected: ["a", "b", "c"],
		},
		{
			name: "applies a genuine reorder",
			current: ["a", "b", "c"],
			reported: ["b", "a", "c"],
			expected: ["b", "a", "c"],
		},
		{
			name: "restores an omitted item at its prior index, not appended",
			current: ["a", "b", "c"],
			reported: ["c", "a"],
			expected: ["c", "b", "a"],
		},
		{
			name: "restores several omitted items at their prior indexes",
			current: ["a", "b", "c", "d"],
			reported: ["d"],
			expected: ["a", "b", "c", "d"],
		},
		{
			name: "skips unknown ids",
			current: ["a", "b"],
			reported: ["x", "b", "a"],
			expected: ["b", "a"],
		},
		{
			name: "skips the shadow placeholder id",
			current: ["a", "b", "c"],
			reported: ["b", SHADOW_PLACEHOLDER_ITEM_ID, "c"],
			expected: ["a", "b", "c"],
		},
		{
			name: "takes each current id at most once when reported repeats it",
			current: ["a", "b", "c"],
			reported: ["c", "a", "c", "b"],
			expected: ["c", "a", "b"],
		},
		{
			name: "restores the full current list when reported is empty",
			current: ["a", "b"],
			reported: [],
			expected: ["a", "b"],
		},
		{
			name: "returns empty when current is empty",
			current: [],
			reported: ["a", "b"],
			expected: [],
		},
	])("$name", ({ current, reported, expected }) => {
		const currentItems = current.map((id) => item(id));
		const reportedItems = reported.map((id) => item(id));
		const out = applyOrder(currentItems, reportedItems);
		expect(ids(out)).toEqual(expected);
		sameMultiset(out, currentItems);
	});

	it("returns the current objects, not the reported copies", () => {
		const a = item("a", { v: 1 });
		const b = item("b", { v: 2 });
		const reportedA = item("a", { v: 99 });
		const out = applyOrder([a, b], [b, reportedA]);
		expect(out).toEqual([b, a]);
		expect(out[1]).toBe(a);
		expect((out[1] as { v?: number }).v).toBe(1);
	});

	it("returns a NEW array without mutating either input", () => {
		const current = [item("a"), item("b")];
		const reported = [item("b"), item("a")];
		const out = applyOrder(current, reported);
		expect(out).not.toBe(current);
		expect(out).not.toBe(reported);
		expect(ids(current)).toEqual(["a", "b"]);
		expect(ids(reported)).toEqual(["b", "a"]);
	});
});

describe("moveById", () => {
	it("moves the item one step down", () => {
		const a = item("a");
		const b = item("b");
		const c = item("c");
		expect(moveById([a, b, c], "a", 1)?.map((i) => i.id)).toEqual(["b", "a", "c"]);
	});

	it("moves the item one step up", () => {
		const a = item("a");
		const b = item("b");
		const c = item("c");
		expect(moveById([a, b, c], "c", -1)?.map((i) => i.id)).toEqual(["a", "c", "b"]);
	});

	it("returns null when the move would leave the list", () => {
		const input = [item("a"), item("b")];
		expect(moveById(input, "a", -1)).toBeNull();
		expect(moveById(input, "b", 1)).toBeNull();
	});

	it("returns null for an unknown id", () => {
		expect(moveById([item("a"), item("b")], "z", 1)).toBeNull();
	});

	it("returns a NEW array without mutating the input", () => {
		const input = [item("a"), item("b")];
		const out = moveById(input, "a", 1);
		expect(out).not.toBe(input);
		expect(input.map((i) => i.id)).toEqual(["a", "b"]);
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
