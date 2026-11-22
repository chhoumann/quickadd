import { Platform } from "obsidian";
import { getOwnerWindow } from "../../utils/activeWindow";

/**
 * The desktop "arm drag by grabbing the handle" state machine, shared by every drag
 * zone so they can't drift (and so all carry the click-swallow FAILSAFE). On desktop a
 * row is only draggable once its handle is pressed (armed). Mobile has no handle: the
 * whole row drags by long-press (delayTouchStart), so `disabled` ignores `armed` there.
 *
 * The failsafe: arming flips the zone draggable on the handle's pointerdown, but a press
 * that never becomes a drag (a stray click/tap on the handle) leaves svelte-dnd-action
 * with no `finalize` to fire — so the zone would stay draggable and the library would
 * SWALLOW the next row-button click. We disarm on the next pointer release UNLESS a real
 * drag started (markStarted, called from the zone's consider handler, hands the disarm
 * to the finalize/reset path). Capture phase so a stopPropagation in the library's own
 * handlers can't hide the release. The listener goes on the handle's own window, since
 * a release in a popout never reaches the main one.
 *
 * Usage: `const drag = createDragArming(() => forceDragDisabled);`
 *  - dragDisabled: `drag.disabled`
 *  - startDrag (handle pointerdown): `drag.startDrag(event)`
 *  - consider handler: `drag.markStarted()`
 *  - finalize handler: `drag.reset()`
 */
export function createDragArming(forceDisabled: () => boolean = () => false) {
	const isMobile = Platform.isMobile;
	let armed = $state(false);
	// Non-reactive: did arming become a real drag (a `consider` fired)? Tells the
	// failsafe whether the finalize/reset path already owns the disarm.
	let started = false;

	function startDrag(event: Event) {
		armed = true;
		started = false;
		const win = getOwnerWindow(event.target as Node);
		const disarm = () => {
			win.removeEventListener("pointerup", disarm, true);
			win.removeEventListener("pointercancel", disarm, true);
			if (!started) armed = false;
		};
		win.addEventListener("pointerup", disarm, true);
		win.addEventListener("pointercancel", disarm, true);
	}

	return {
		/** Reactive: is a desktop drag currently armed (handle pressed)? */
		get armed() {
			return armed;
		},
		/** Reactive: the zone's `dragDisabled`. */
		get disabled() {
			return forceDisabled() || (!isMobile && !armed);
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
