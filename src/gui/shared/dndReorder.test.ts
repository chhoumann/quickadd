import { describe, expect, it } from "vitest";
import { type DndEvent, SHADOW_ITEM_MARKER_PROPERTY_NAME, SHADOW_PLACEHOLDER_ITEM_ID } from "svelte-dnd-action";
import {
	baseDndOptions,
	createDropRecovery,
	keyedItems,
	moveById,
	replaceById,
	stripShadow,
} from "./dndReorder";

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

describe("keyedItems", () => {
	it("keeps the first of each unique string id and drops holes", () => {
		const a = item("a");
		const input = [a, null, 7, item(""), { name: "no id" }, item("a", { dup: true }), item("b")];
		expect(keyedItems(input)).toEqual([a, item("b")]);
	});

	it("reads a non-array as empty", () => {
		expect(keyedItems({ 0: item("a") })).toEqual([]);
	});
});

describe("createDropRecovery", () => {
	type Item = { id: string; name: string };
	const event = (items: unknown[], id: string) =>
		({ detail: { items, info: { id } } }) as unknown as CustomEvent<DndEvent<Item>>;
	const shadow = (of: Item) => ({
		...of,
		id: SHADOW_PLACEHOLDER_ITEM_ID,
		[SHADOW_ITEM_MARKER_PROPERTY_NAME]: true,
	});
	const a = { id: "a", name: "A" };
	const b = { id: "b", name: "B" };
	const c = { id: "c", name: "C" };

	it("puts back a dragged item a drop inside the placeholder window left out (#1692)", () => {
		const zone = createDropRecovery<Item>();
		expect(zone.consider(event([b, shadow(a), c], "a"))).toEqual([b, c]);
		expect(zone.finalize(event([b, c], "a"))).toEqual([b, a, c]);
	});

	it("leaves a finalized list that already holds the dragged item alone", () => {
		const zone = createDropRecovery<Item>();
		zone.consider(event([shadow(a), b], "a"));
		expect(zone.finalize(event([b, a], "a"))).toEqual([b, a]);
	});

	it("forgets the payload once the drag finalizes", () => {
		const zone = createDropRecovery<Item>();
		zone.consider(event([shadow(a), b], "a"));
		zone.finalize(event([a, b], "a"));
		expect(zone.finalize(event([b], "a"))).toEqual([b]);
	});
});
