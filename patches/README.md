# Dependency patches

Applied by pnpm via `pnpm.patchedDependencies` in `package.json`. If a version bump
makes a patch fail to apply, re-check whether upstream fixed the issue before
re-creating it (`pnpm patch <pkg>@<version>` / `pnpm patch-commit`).

## svelte-dnd-action@0.9.79

Obsidian 1.13 opens Settings in a popout window. The library used the
module-global `window`/`document` (QuickAdd's main window) for a drop zone that
lives in the popout's document, so:

- `keepOriginalElementInDom` was scheduled with the main window's
  `requestAnimationFrame`, which is paused while that window is hidden or
  occluded (Windows occlusion tracking). The drag never started observing, so
  the list never reordered and the item snapped back (#1730).
- `isElementOffDocument` compared the clone against the main document's size;
  a popout taller than the main window ended the drag immediately.
- The edge auto-scroller re-armed itself with the main window's frames.

The patch resolves the window/document from the element (`ownerDocument.defaultView`).
