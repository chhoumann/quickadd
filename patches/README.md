# Dependency patches

Applied by pnpm via `pnpm.patchedDependencies` in `package.json`. If a version bump
makes a patch fail to apply, re-check whether upstream fixed the issue before
re-creating it (`pnpm patch <pkg>@<version>` / `pnpm patch-commit`).

## svelte-dnd-action@0.9.79

### Why

Obsidian 1.13 opens Settings in a popout window by default (`Settings → Interface →
Open settings in new window`). QuickAdd's drop zones then live in the popout's
`Document`, but the library resolves `window`/`document` from module globals, which
are QuickAdd's *main* window. Three sites break under real conditions (#1730):

- `keepOriginalElementInDom` (pointerAction.js) was scheduled with the main window's
  `requestAnimationFrame`. Chromium pauses frames for hidden windows, and on Windows
  a fully covered window counts as hidden (occlusion tracking), so with the settings
  window over the main window the drag never started observing: the row followed the
  cursor as a full-row clone, the list never opened a gap, and the item snapped back.
- `isElementOffDocument` (helpers/intersection.js) compared the clone against the
  main document's `scrollWidth/scrollHeight`. A popout taller than the main window
  ended any drag that started below the main window's height immediately, with
  `TypeError: Cannot read properties of undefined (reading 'style')` from
  `hideElement(originalDragTarget)` after the synchronous drop.
- `scrollContainer` (helpers/scroller.js) re-armed edge auto-scroll with the main
  window's frames, so auto-scroll stopped under the same occlusion.

The patch resolves the window/document from the element
(`el.ownerDocument.defaultView || window`) at those three sites, in `src/` and both
`dist/` builds (esbuild bundles `dist/index.mjs`; vitest also resolves `dist/index.mjs`).

### Evidence

Reproduced on Linux (Obsidian 1.13.7, Xvfb, CDP) with `settingsPopoutWindow: true`
and the main `BrowserWindow` hidden (`document.visibilityState === "hidden"`, main
`requestAnimationFrame` confirmed paused). Before: clone `class=""`, no pill, order
unchanged, `settings.choices` unchanged. After: `qa-drag-clone` pill, live reorder,
persisted. Tall-popout case and edge auto-scroll verified the same way; classic
in-window Settings unchanged. `tests/dnd-popout-window.test.ts` covers the first two
sites against the real library with the zone in a second jsdom window.

### Same class, not patched (no failing before/after in Obsidian)

Every remaining module-global `window`/`document` use in 0.9.79 is the same mistake.
None of these misbehave in Obsidian today; they are listed so nobody re-derives this.
Patch one only with a reproduced before/after, as above.

- `window.addEventListener("mousemove" | "mouseup" | "touchmove" | "touchend" | …)`
  and the `draggedLeftDocument` window event: registered on the main window. Works
  because Obsidian re-dispatches popout window-level events to the main window
  (probed: 5 popout `mousemove`s → 5 main-window listener calls, 0 main-`document`
  calls). Any host without that forwarding would never start a drag.
- `window.scrollX/scrollY` in `getReferencePoint`, `getAbsoluteRect`,
  `getAbsoluteRectNoTransforms`: both the cursor and the zone rects get the *main*
  window's offset, so they stay consistent with each other. Obsidian's main document
  is not scrollable (measured `documentElement.scrollHeight === innerHeight`), so
  the offset is 0 anyway.
- `getVisibleRectRecursive` walks ancestors until main `document.body`; in a popout
  it walks to `null` instead, passing the popout's `body`/`html`. Harmless unless a
  theme gives those `overflow: auto | scroll`, and even then they are the viewport.
- `findRelevantScrollContainers` adds main `document.scrollingElement` when it is
  scrollable; it is not in Obsidian.
- `scheduleDZForRemovalAfterDrop` (zone destroyed mid-drag, e.g. a nested folder
  zone inside the dragged row): main-window `requestAnimationFrame` plus
  `document.body.appendChild(dz)`, which would adopt the popout element into the
  main document. With the main window hidden the frame never runs and the zone is
  cleaned up at drop instead; no visible difference found.
- `aria.js` writes live regions to main `document.body`; QuickAdd sets
  `autoAriaDisabled: true`.

### Full fix (upstream)

Resolve `doc = zoneEl.ownerDocument` / `win = doc.defaultView` once per drag in
`handleDragStart` (and per zone in `configure`) and thread them through
`pointerAction.js`, `helpers/observer.js`, `helpers/intersection.js`,
`helpers/scroller.js`, `helpers/multiScroller.js`, `helpers/aria.js` in place of
the globals. Roughly fifteen sites, no API change; the clone already does this via
`originDropZone.getRootNode()`. The `src/` hunks of this patch are that change for
the three proven sites. Not filed upstream as of this writing.

Workaround for users without the patch: turn off `Settings → Interface → Open
settings in new window`, or keep the main Obsidian window visible while reordering.
