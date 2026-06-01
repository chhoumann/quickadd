/**
 * The desktop "arm drag by grabbing the handle" state machine, shared by the choices
 * list and the macro builder so they can't drift (and so both carry the click-swallow
 * FAILSAFE). On desktop a row is only draggable once its handle is pressed (armed);
 * mobile is gated separately by delayTouchStart, so callers fold `armed` into their own
 * `dragDisabled` derived alongside isMobile / forceDragDisabled.
 *
 * The failsafe: arming flips the zone draggable on the handle's pointerdown, but a press
 * that never becomes a drag (a stray click/tap on the handle) leaves svelte-dnd-action
 * with no `finalize` to fire — so the zone would stay draggable and the library would
 * SWALLOW the next row-button click. We disarm on the next pointer release UNLESS a real
 * drag started (markStarted, called from the zone's consider handler, hands the disarm
 * to the finalize/reset path). Capture phase so a stopPropagation in the library's own
 * handlers can't hide the release.
 *
 * Usage: `const drag = createDragArming();`
 *  - dragDisabled (component derived): `forceDragDisabled || (!isMobile && !drag.armed)`
 *  - startDrag (handle pointerdown): `drag.startDrag()`
 *  - consider handler: `drag.markStarted()`
 *  - finalize handler: `drag.reset()`
 */
export function createDragArming() {
	let armed = $state(false);
	// Non-reactive: did arming become a real drag (a `consider` fired)? Tells the
	// failsafe whether the finalize/reset path already owns the disarm.
	let started = false;

	function startDrag() {
		armed = true;
		started = false;
		const disarm = () => {
			window.removeEventListener("pointerup", disarm, true);
			window.removeEventListener("pointercancel", disarm, true);
			if (!started) armed = false;
		};
		window.addEventListener("pointerup", disarm, true);
		window.addEventListener("pointercancel", disarm, true);
	}

	return {
		/** Reactive: is a desktop drag currently armed (handle pressed)? */
		get armed() {
			return armed;
		},
		/** Call from the dndzone's consider handler — a genuine drag is underway. */
		markStarted() {
			started = true;
		},
		/** Call from the dndzone's finalize handler — disarm after a completed drag. */
		reset() {
			armed = false;
			started = false;
		},
		startDrag,
	};
}
