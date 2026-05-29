<script lang="ts">
    import ObsidianIcon from "./ObsidianIcon.svelte";

    // Shared drag-to-reorder handle (#1250). Keeps the existing POINTER drag AND adds
    // keyboard reorder: ArrowUp/ArrowDown move the row one step via onMoveUp/onMoveDown.
    // It is a real <button> so it is focusable and announced; the list sets
    // autoAriaDisabled on the dndzone so the library no longer injects its own
    // (conflicting) role/tabindex/keydown handling.
    //
    // Pointer drag: pressing the handle flips the list's `dragDisabled` to false;
    // svelte-dnd-action then attaches its mousedown/touchstart listeners and begins the
    // drag on the compatibility mousedown that follows. We fire onDragStart on
    // `pointerdown` (earliest, covers mouse+touch+pen) and must NOT call preventDefault
    // here — preventDefault on pointerdown suppresses that compat mousedown in Chromium
    // and the library would never see it (drag silently breaks).
    let {
        label,
        dragDisabled,
        onDragStart,
        onMoveUp,
        onMoveDown,
        size = 16,
    }: {
        /** Accessible name, e.g. "Reorder Daily note". */
        label: string;
        dragDisabled: boolean;
        /** Arm the list's pointer drag (flip dragDisabled=false). Must not preventDefault. */
        onDragStart: () => void;
        onMoveUp?: () => void;
        onMoveDown?: () => void;
        size?: number;
    } = $props();

    // Only advertise/handle arrow reorder when the list actually provides it (e.g. a
    // filtered choice view passes no move callbacks — the handle must not announce a
    // shortcut that does nothing nor swallow the arrow keys).
    const reorderable = $derived(Boolean(onMoveUp || onMoveDown));

    function onKeyDown(event: KeyboardEvent) {
        if (event.key === "ArrowUp" && onMoveUp) {
            // preventDefault stops the settings pane from scrolling; stopPropagation
            // keeps the key from reaching svelte-dnd-action's window-level handler.
            event.preventDefault();
            event.stopPropagation();
            onMoveUp();
        } else if (event.key === "ArrowDown" && onMoveDown) {
            event.preventDefault();
            event.stopPropagation();
            onMoveDown();
        }
    }
</script>

<button
    type="button"
    class="qa-icon-button qa-drag-handle"
    class:qa-drag-handle-ready={dragDisabled}
    class:qa-drag-handle-active={!dragDisabled}
    aria-label={label}
    aria-keyshortcuts={reorderable ? "ArrowUp ArrowDown" : undefined}
    tabindex={dragDisabled ? 0 : -1}
    onpointerdown={() => onDragStart()}
    onkeydown={onKeyDown}
>
    <ObsidianIcon iconId="grip-vertical" {size} />
</button>
