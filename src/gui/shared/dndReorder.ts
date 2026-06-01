import { SHADOW_PLACEHOLDER_ITEM_ID } from "svelte-dnd-action";
import { transformDragPill } from "./dragPill";

/** Anything svelte-dnd-action can reorder in QuickAdd: it has a stable string id. */
export interface Reorderable {
	id: string;
}

/** A QuickAdd drag item: reorderable, with a display name and a type discriminator. */
type DragItem = Reorderable & { name?: string; type?: string };

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

/**
 * Shared svelte-dnd-action options for QuickAdd's two drag zones (choices view + macro
 * builder). These options are COUPLED and must move together (see dragPill.ts):
 *  - morphDisabled:true  <-> the custom pill (else the lib re-inflates the clone to
 *    full-row width every consider tick and fights the pill),
 *  - centreDraggedOnCursor:false (explicit) + useCursorForDetection:true — the pill is
 *    small and cursor-anchored, so the hit-test follows the cursor and we must NOT yank
 *    the full-row box onto it,
 *  - dropTargetStyle:{} hands the active-drop highlight entirely to CSS,
 *  - autoAriaDisabled:true removes the lib's SR roles/alerts — each zone OWES its own
 *    (see the alertToScreenReader calls on keyboard reorder),
 *  - zoneItemTabIndex:-1 keeps rows out of the tab order,
 *  - delayTouchStart gates touch drags (desktop is gated by the dragArmed handle).
 * Per-zone overrides: items, dragDisabled, type, dropTargetClasses, flipDurationMs (kept
 * in sync with animate:flip), and resolveLabel (the pill text — defaults to item.name;
 * the macro builder passes getCommandDisplayName, since a command's `.name` differs from
 * its rendered label for Choice/Conditional commands).
 */
export function baseDndOptions<T extends DragItem>(opts: {
	items: T[];
	dragDisabled: boolean;
	resolveLabel?: (item: T) => string;
	type?: string;
	dropTargetClasses?: string[];
	flipDurationMs?: number;
}) {
	const resolveLabel = opts.resolveLabel ?? ((item: T) => item.name ?? "");
	return {
		items: opts.items,
		dragDisabled: opts.dragDisabled,
		flipDurationMs: opts.flipDurationMs ?? 0,
		morphDisabled: true,
		useCursorForDetection: true,
		centreDraggedOnCursor: false,
		transformDraggedElement: (el?: HTMLElement, data?: T) =>
			transformDragPill(el, data ? resolveLabel(data) : "", data?.type === "Multi"),
		dropTargetStyle: {},
		dropTargetClasses: opts.dropTargetClasses ?? [],
		autoAriaDisabled: true,
		zoneItemTabIndex: -1,
		delayTouchStart: 200,
		...(opts.type ? { type: opts.type } : {}),
	};
}
