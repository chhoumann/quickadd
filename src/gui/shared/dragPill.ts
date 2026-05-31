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
 * dndzone `transformDraggedElement` handler: build/refresh the compact drag pill.
 * The library invokes this on every consider tick, so the pill node is created once
 * and reused (only its label text is updated). `data` is the dragged item; we read
 * its name (shown as text — no markdown render, auto-escaped) and whether it is a
 * folder (Multi) for the differentiated dashed-border styling.
 */
export function transformDragPill(
	el: HTMLElement | undefined,
	data: { name?: string; type?: string } | undefined,
): void {
	if (!el || !data) return;
	el.classList.add("qa-drag-clone");
	el.dataset.qaMulti = data.type === "Multi" ? "true" : "false";

	let pill = el.querySelector<HTMLDivElement>(":scope > .qa-drag-pill");
	if (!pill) {
		pill = document.createElement("div");
		pill.className = "qa-drag-pill";
		const grip = document.createElement("span");
		grip.className = "qa-drag-pill-grip";
		grip.innerHTML = GRIP_SVG; // static inline glyph — no Obsidian render pass
		const label = document.createElement("span");
		label.className = "qa-drag-pill-label";
		pill.append(grip, label);
		el.appendChild(pill);
	}

	const label = pill.querySelector<HTMLSpanElement>(".qa-drag-pill-label");
	const name = data.name ?? "";
	if (label && label.textContent !== name) label.textContent = name;
}
