// Turns svelte-dnd-action's full-row drag clone (#dnd-action-dragged-el) into a
// compact pill that sits under the cursor — passed as a dndzone's
// `transformDraggedElement`. Pairs with the #dnd-action-dragged-el / .qa-drag-pill
// rules in styles.css (the clone is created by the library, so it can't be styled
// from a Svelte-scoped <style>), and REQUIRES morphDisabled:true on the zone — else
// the library re-inflates the clone to full-row width every consider tick (lib
// index.js ~2094) and fights the pill. centreDraggedOnCursor MUST be off too: the
// pill is the only visible thing, so there is no full-row ghost to "yank" onto the
// cursor (the feedback that the grab "puts the cursor in the middle").

// 6-dot vertical grip glyph: two columns (x=9, x=15) × three rows (y=5, 12, 19).
const GRIP_DOTS: ReadonlyArray<readonly [number, number]> = [
	[9, 5],
	[9, 12],
	[9, 19],
	[15, 5],
	[15, 12],
	[15, 19],
];

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
		// Build via Obsidian's DOM helpers (ownerDocument-safe, popout-aware) and
		// the SVG namespace API, rather than `document.createElement` + innerHTML.
		pill = el.createDiv({ cls: "qa-drag-pill" });
		const grip = pill.createSpan({ cls: "qa-drag-pill-grip" });
		const svg = grip.createSvg("svg", {
			attr: {
				viewBox: "0 0 24 24",
				width: 14,
				height: 14,
				fill: "none",
				stroke: "currentColor",
				"stroke-width": 2,
				"stroke-linecap": "round",
				"stroke-linejoin": "round",
			},
		});
		for (const [cx, cy] of GRIP_DOTS) {
			svg.createSvg("circle", { attr: { cx, cy, r: 1 } });
		}
		pill.createSpan({ cls: "qa-drag-pill-label" });
	}

	const textEl = pill.querySelector<HTMLSpanElement>(".qa-drag-pill-label");
	if (textEl && textEl.textContent !== label) textEl.textContent = label;
}
