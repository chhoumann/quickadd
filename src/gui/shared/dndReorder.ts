import { SHADOW_ITEM_MARKER_PROPERTY_NAME, SHADOW_PLACEHOLDER_ITEM_ID } from "svelte-dnd-action";
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

/** What a drop needs to undo an over-eager placeholder strip: the item and where it stood. */
export interface PlaceholderRecovery<T> {
	item: T;
	index: number;
}

/**
 * Capture a recovery payload from the shadow placeholder BEFORE stripShadow
 * discards it. The placeholder still carries SHADOW_PLACEHOLDER_ITEM_ID at
 * DRAG_STARTED and on the first DRAGGED_ENTERED (dispatched before the library
 * swaps in the real id), so stripping it leaves the zone with no trace of the
 * dragged item — a drop inside that window would commit, and persist, the list
 * without it (#1692). The shadow is a spread-copy of the dragged item, so
 * restoring the real id (the event's `info.id`) and dropping the library's
 * marker yields a faithful stand-in — in ANY zone, including the destination of
 * a cross-zone drag, which has no pre-drag snapshot of its own to recover from.
 */
export function capturePlaceholderRecovery<T extends Reorderable>(
	items: readonly T[],
	draggedId: string,
): PlaceholderRecovery<T> | null {
	const index = items.findIndex((item) => item.id === SHADOW_PLACEHOLDER_ITEM_ID);
	if (index === -1) return null;
	const shadow = { ...(items[index] as T & Record<string, unknown>) };
	delete shadow[SHADOW_ITEM_MARKER_PROPERTY_NAME];
	return { item: { ...shadow, id: draggedId } as T, index };
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
 * in sync with animate:flip), resolveLabel (the pill text — defaults to item.name;
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
		// With flipDurationMs 0 the drop "animation" was already invisible; disabling
		// it entirely also removes the library's finalize-time animation-target lookup
		// (`children[originIndex]`), which THROWS when the LAST row is dropped during
		// the placeholder window (stripShadow left the zone one child short) — the
		// finalize then never fires, the drag never cleans up, and the list renders
		// without the row until the settings tab is rebuilt (#1692, second wave).
		dropAnimationDisabled: true,
		autoAriaDisabled: true,
		zoneItemTabIndex: -1,
		delayTouchStart: 200,
		...(opts.type ? { type: opts.type } : {}),
	};
}
