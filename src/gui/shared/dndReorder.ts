import { type DndEvent, SHADOW_ITEM_MARKER_PROPERTY_NAME, SHADOW_PLACEHOLDER_ITEM_ID, TRIGGERS } from "svelte-dnd-action";
import { transformDragPill } from "./dragPill";

/** Anything svelte-dnd-action can reorder in QuickAdd: it has a stable string id. */
export interface Reorderable {
	id: string;
}

/** A QuickAdd drag item: reorderable, with a display name and a type discriminator. */
type DragItem = Reorderable & { name?: string; type?: string };

/**
 * Removes svelte-dnd-action's shadow-placeholder item, returning a new array.
 * Apply it in both the consider/finalize handlers and the {#each}, so a
 * placeholder never lingers in state and leaves a ghost gap.
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
 * Captures a recovery payload from the shadow placeholder before stripShadow
 * discards it. The placeholder still carries SHADOW_PLACEHOLDER_ITEM_ID at
 * DRAG_STARTED and the first DRAGGED_ENTERED, so stripping it leaves the zone
 * with no trace of the dragged item, and a drop in that window would persist the
 * list without it. The shadow is a spread-copy of the item, so restoring the real
 * id yields a faithful stand-in in any zone.
 */
export function capturePlaceholderRecovery<T extends Reorderable>(
	items: readonly T[],
	draggedId: string,
): PlaceholderRecovery<T> | null {
	const index = items.findIndex((item) => item.id === SHADOW_PLACEHOLDER_ITEM_ID);
	if (index === -1) return null;
	const shadow = { ...(items[index] as T & Record<string, unknown>) };
	delete shadow[SHADOW_ITEM_MARKER_PROPERTY_NAME];
	return { item: { ...shadow, id: draggedId }, index };
}

/**
 * One zone's bookkeeping for the placeholder window. `consider` strips the
 * placeholder after capturing a recovery payload; `finalize` strips it again and,
 * when the dragged item is missing, puts the payload back where the placeholder
 * last stood. Not the pre-drag order: the first DRAGGED_ENTERED can already carry
 * the intended position.
 */
export function createDropRecovery<T extends Reorderable>() {
	let recovery: PlaceholderRecovery<T> | null = null;
	return {
		consider(event: CustomEvent<DndEvent<T>>): T[] {
			const { items, info } = event.detail;
			recovery = capturePlaceholderRecovery(items, info.id) ?? recovery;
			return stripShadow(items);
		},
		finalize(event: CustomEvent<DndEvent<T>>): T[] {
			const next = stripShadow(event.detail.items);
			const draggedId = event.detail.info.id;
			const pending = recovery;
			recovery = null;
			if (pending?.item.id === draggedId && !next.some((item) => item.id === draggedId)) {
				next.splice(Math.min(pending.index, next.length), 0, pending.item);
			}
			return next;
		},
	};
}

/**
 * The entries of `value` a zone can key: objects with a unique, non-empty string
 * id. The keyed {#each} throws `each_key_duplicate` on a repeat, and after mount
 * that throw escapes mountComponent, so zones run this in a $derived. Lists are
 * normalized before they get here, so in practice this only drops a `null` or
 * primitive hole. Keep it that narrow: a zone persists what it renders.
 */
export function keyedItems<T extends Reorderable>(value: unknown): T[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	return value.filter((item): item is T => {
		if (typeof item !== "object" || item === null) return false;
		const id: unknown = (item as { id?: unknown }).id;
		if (typeof id !== "string" || id === "" || seen.has(id)) return false;
		seen.add(id);
		return true;
	});
}

/**
 * Immutably replaces the item whose id matches `next.id`. An in-place
 * `items[index] = next` loses reactivity on a runes `$state` array.
 */
export function replaceById<T extends Reorderable>(
	items: readonly T[],
	next: T,
): T[] {
	return items.map((item) => (item.id === next.id ? next : item));
}

/**
 * Move the item with `id` by `delta` positions. Returns null when the id is
 * unknown or the move would leave the list.
 */
export function moveById<T extends Reorderable>(
	items: readonly T[],
	id: string,
	delta: number,
): T[] | null {
	const index = items.findIndex((item) => item.id === id);
	if (index === -1) return null;
	const target = index + delta;
	if (target < 0 || target >= items.length || target === index) return null;
	const next = [...items];
	const [moved] = next.splice(index, 1);
	next.splice(target, 0, moved);
	return next;
}

const nameLabel = (item: DragItem) => item.name ?? "";

/**
 * Turns the library's drag clone into the pill as a drag starts. The library
 * only does it once the zone renders the shadow item, which stripShadow leaves
 * out, so a touch drag would show the whole row until the finger moved. Call
 * from a zone's consider handler.
 */
export function showDragPillOnStart<T extends DragItem>(
	event: CustomEvent<DndEvent<T>>,
	resolveLabel: (item: T) => string = nameLabel,
): void {
	if (event.detail.info.trigger !== TRIGGERS.DRAG_STARTED) return;
	const dragged = event.detail.items.find((item) => item.id === SHADOW_PLACEHOLDER_ITEM_ID);
	const zone = event.currentTarget as HTMLElement | null;
	const clone = zone?.ownerDocument.getElementById("dnd-action-dragged-el");
	if (!dragged || !clone) return;
	transformDragPill(clone, resolveLabel(dragged), dragged.type === "Multi");
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
 * Per-zone overrides: items, dragDisabled, type, dropTargetClasses, resolveLabel (the
 * pill text — defaults to item.name; the macro builder passes getCommandDisplayName,
 * since a command's `.name` differs from its rendered label for Choice/Conditional
 * commands).
 */
export function baseDndOptions<T extends DragItem>(opts: {
	items: T[];
	dragDisabled: boolean;
	resolveLabel?: (item: T) => string;
	type?: string;
	dropTargetClasses?: string[];
}) {
	const resolveLabel = opts.resolveLabel ?? nameLabel;
	return {
		items: opts.items,
		dragDisabled: opts.dragDisabled,
		// 0 keeps the reorder continuous: the library ties its position-observation
		// interval to it (0 => 20ms polling; any value > 0 => ~107ms+, which felt
		// "batched"). So the zones skip the row-glide animation.
		flipDurationMs: 0,
		morphDisabled: true,
		useCursorForDetection: true,
		centreDraggedOnCursor: false,
		transformDraggedElement: (el?: HTMLElement, data?: T) =>
			transformDragPill(el, data ? resolveLabel(data) : "", data?.type === "Multi"),
		dropTargetStyle: {},
		dropTargetClasses: opts.dropTargetClasses ?? [],
		// Disabling the drop animation also removes the library's finalize-time
		// `children[originIndex]` lookup, which throws when the last row is dropped
		// during the placeholder window, leaving the drag uncleaned.
		dropAnimationDisabled: true,
		autoAriaDisabled: true,
		zoneItemTabIndex: -1,
		delayTouchStart: 200,
		...(opts.type ? { type: opts.type } : {}),
	};
}
