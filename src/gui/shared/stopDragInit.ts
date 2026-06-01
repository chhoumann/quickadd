/**
 * Svelte action: stop this element's press from reaching svelte-dnd-action's per-item
 * `mousedown`/`touchstart` listener (which lives directly on the draggable row).
 *
 * Why an action and not `onmousedown`/`ontouchstart` handlers: Svelte 5 DELEGATES those
 * events to the document root, so a component handler runs only after the event has
 * bubbled all the way up — i.e. AFTER it already passed through the draggable row and
 * fired the library's listener there. A direct `addEventListener` on the control runs in
 * the bubble phase AT the control, before the row's listener, so `stopPropagation` here
 * actually prevents it.
 *
 * The point: an interactive control (icon button, folder toggle) is an ACTION, never a
 * drag start. Without this, on touch the library treats the tap as a maybe-drag and, on
 * touchend, REPLAYS a synthetic click (handleFalseAlarm, dist/index.js:1840) on top of
 * the native click — firing the control TWICE (Duplicate makes two copies, a folder
 * toggle opens-then-shuts). The drag handle is a SEPARATE button without this action, so
 * dragging is unaffected. Inert outside a dndzone (no library listener to stop).
 */
export function stopDragInit(node: HTMLElement) {
	const stop = (e: Event) => e.stopPropagation();
	node.addEventListener("mousedown", stop);
	node.addEventListener("touchstart", stop, { passive: true });
	return {
		destroy() {
			node.removeEventListener("mousedown", stop);
			node.removeEventListener("touchstart", stop);
		},
	};
}
