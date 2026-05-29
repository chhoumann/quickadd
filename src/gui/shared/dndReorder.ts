import { SHADOW_PLACEHOLDER_ITEM_ID } from "svelte-dnd-action";

/** Anything svelte-dnd-action can reorder in QuickAdd: it has a stable string id. */
export interface Reorderable {
	id: string;
}

/**
 * Remove svelte-dnd-action's internal shadow-placeholder item, returning a NEW
 * array. Must be applied in BOTH the consider/finalize handlers AND the {#each}
 * so a placeholder can never linger in state and vanish / leave a ghost gap on
 * reorder (bugs #1244 / #883). Extracted to ONE tested helper so the three
 * call-sites per list can't drift apart.
 */
export function stripShadow<T extends Reorderable>(items: readonly T[]): T[] {
	return items.filter((item) => item.id !== SHADOW_PLACEHOLDER_ITEM_ID);
}

/**
 * Immutably replace the item whose id matches `next.id`, preserving order and
 * returning a NEW array. Replaces the in-place `items[index] = next` mutation,
 * which silently loses reactivity on a runes `$state`/`$bindable` array.
 */
export function replaceById<T extends Reorderable>(
	items: readonly T[],
	next: T,
): T[] {
	return items.map((item) => (item.id === next.id ? next : item));
}
