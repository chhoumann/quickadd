// Turns svelte-dnd-action's full-row drag clone (#dnd-action-dragged-el) into a
// compact pill that sits under the cursor — passed as a dndzone's
// `transformDraggedElement`. Pairs with the #dnd-action-dragged-el / .qa-drag-pill
// rules in styles.css (the clone is created by the library, so it can't be styled
// from a Svelte-scoped <style>), and REQUIRES morphDisabled:true on the zone — else
// the library re-inflates the clone to full-row width every consider tick (lib
// index.js ~2094) and fights the pill. centreDraggedOnCursor MUST be off too: the
// pill is the only visible thing, so there is no full-row ghost to "yank" onto the
// cursor (the feedback that the grab "puts the cursor in the middle").

const GRIP_SVG =
	'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>';

/**
 * Build/refresh the compact drag pill. The library invokes the zone's
 * `transformDraggedElement` on every consider tick, so the pill node is created once
 * and reused (only its label text is updated). The caller passes a PRE-RESOLVED
 * `label` — each zone owns its own label semantics (the choices zone uses the choice
 * name; the macro builder must resolve via getCommandDisplayName, since a command's
 * `.name` differs from its rendered label for Choice/Conditional commands). `label` is
 * set as textContent (no markdown render, auto-escaped). `isMulti` draws the dashed
 * folder variant — only meaningful for the choices zone (a command is never Multi).
 */
export function transformDragPill(
	el: HTMLElement | undefined,
	label: string,
	isMulti = false,
): void {
	if (!el) return;
	el.classList.add("qa-drag-clone");
	el.dataset.qaMulti = isMulti ? "true" : "false";

	let pill = el.querySelector<HTMLDivElement>(":scope > .qa-drag-pill");
	if (!pill) {
		pill = document.createElement("div");
		pill.className = "qa-drag-pill";
		const grip = document.createElement("span");
		grip.className = "qa-drag-pill-grip";
		grip.innerHTML = GRIP_SVG; // static inline glyph — no Obsidian render pass
		const labelEl = document.createElement("span");
		labelEl.className = "qa-drag-pill-label";
		pill.append(grip, labelEl);
		el.appendChild(pill);
	}

	const textEl = pill.querySelector<HTMLSpanElement>(".qa-drag-pill-label");
	if (textEl && textEl.textContent !== label) textEl.textContent = label;
}
