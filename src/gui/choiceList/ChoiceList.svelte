<script lang="ts">
    import type IChoice from "../../types/choices/IChoice";
    import type IMultiChoice from "../../types/choices/IMultiChoice";
    import ChoiceListItem from "./ChoiceListItem.svelte";
    import MultiChoiceListItem from "./MultiChoiceListItem.svelte";
    import { type DndEvent, dndzone, TRIGGERS } from "svelte-dnd-action";
    import { flip } from "svelte/animate";
    import { stripShadow } from "../shared/dndReorder";
    import { transformDragPill } from "../shared/dragPill";
    import { Platform, type App } from "obsidian";
    import type { ChoiceListActions } from "./choiceListActions";

    let {
        choices = $bindable([]),
        roots,
        app,
        forceDragDisabled = false,
        actions,
        rootReorder,
        isEmptyFolder = false,
    }: {
        choices?: IChoice[];
        roots?: IChoice[];
        app: App;
        forceDragDisabled?: boolean;
        actions: ChoiceListActions;
        // The TOP-LEVEL onReorderChoices, threaded UNCHANGED through every nesting
        // level so a nested Multi persists the whole root tree via the real handler
        // instead of an ancestor Multi's override (which would reinterpret the root
        // array as its own children — data loss at depth >= 2). Undefined at the top.
        rootReorder?: (choices: IChoice[]) => void;
        // PERSISTED emptiness of the folder this list belongs to (passed by the parent
        // MultiChoiceListItem). Sizes the empty-drop band independently of the live
        // `choices` length: previewing a dragged item into the zone momentarily fills
        // `choices` (toggling qa-empty), but the band must NOT resize then — that
        // show/hide was the violent jumping. False/absent at the root level.
        isEmptyFolder?: boolean;
    } = $props();

    // Resolve once: at the top level there is no incoming rootReorder, so the list's
    // own handler IS the top-level handler; nested lists receive it explicitly.
    const persistRoots = $derived(rootReorder ?? actions.onReorderChoices);

    // rootReorder is undefined ONLY at the top-level list (ChoiceView mounts it
    // without one; nested folder lists always receive it — MultiChoiceListItem
    // threads it down). So this reliably means "this is a folder's inner list",
    // used below to mark ONLY nested zones as drop-into-folder targets — the root
    // reorder list never lights up.
    const isNested = $derived(rootReorder !== undefined);

    // Smooth FLIP reorder — svelte-dnd-action's flipDurationMs defaults to 0 (items
    // snap). Read prefers-reduced-motion once at mount (the settings modal opens fresh).
    // flipDurationMs MUST be 0 for a responsive reorder: the library ties its
    // position-observation interval to it — 0 => 20ms polling (continuous), any value
    // > 0 => max(flip,100)*1.07 ≈ 107ms+, which felt "batched" (move several rows, then
    // a jump). We trade the row-glide animation for continuous, predictable reordering.
    const flipDurationMs = 0;

    const isMobile = Platform.isMobile;

    let collapseId = $state("");
    // Desktop: drag is armed by grabbing the handle (dragDisabled until then), which
    // prevents accidental drags when interacting with a row. Mobile: there is no
    // handle — the whole row is draggable by LONG-PRESS (delayTouchStart below), the
    // native mobile reorder gesture — so drag stays enabled unless filtering.
    let dragArmed = $state(false);
    // Did arming actually become a real drag (a `consider` fired)? The failsafe in
    // startDrag uses this to know whether handleSort already owns the disarm.
    let dragStarted = false;
    const dragDisabled = $derived(forceDragDisabled || (!isMobile && !dragArmed));

    function handleConsider(e: CustomEvent<DndEvent>) {
        if (forceDragDisabled) return; // filtered view: never mutate a derived list
        dragStarted = true; // a genuine drag is underway (see startDrag failsafe)
        collapseId = e.detail.info.id;
        // Strip the dnd shadow placeholder so it can't linger and cause ghost gaps
        // (bugs #1244/#883) — see [[svelte-dnd-action-shadow-placeholder]].
        choices = stripShadow(e.detail.items as IChoice[]);
    }

    function handleSort(e: CustomEvent<DndEvent>) {
        if (forceDragDisabled) return;
        collapseId = "";
        let next = stripShadow(e.detail.items as IChoice[]);
        // Cross-zone de-dupe: on DROPPED_INTO_ANOTHER the dragged item landed in a
        // DIFFERENT zone, yet svelte-dnd can still report it in THIS (source) list — so
        // committing this list verbatim would persist a copy in BOTH the source and the
        // target. Strip the dragged item here so it lives only where it was dropped.
        if (e.detail.info.trigger === TRIGGERS.DROPPED_INTO_ANOTHER) {
            next = next.filter((c) => c.id !== e.detail.info.id);
        }
        choices = next;
        // Desktop: disarm so a subsequent row interaction doesn't drag (handle must be
        // grabbed again). Mobile: dragDisabled ignores dragArmed, so this is a no-op.
        dragArmed = false;
        dragStarted = false;
        actions.onReorderChoices(choices);
    }

    let startDrag = () => {
        if (forceDragDisabled) return; // do not enable drag while filtering
        dragArmed = true;
        dragStarted = false;
        // Failsafe: arming flips the zone draggable on the handle's pointerdown, but a
        // press that never becomes a drag (a stray click/tap on the handle) leaves
        // svelte-dnd-action without a `finalize` to fire — so handleSort never disarms,
        // the zone stays draggable, and the library SWALLOWS row button clicks (e.g.
        // the Multi collapse toggle). Disarm on the next pointer release; a genuine drag
        // sets dragStarted (handleConsider) so its handleSort keeps the reset. Capture
        // phase so a stopPropagation in the library's handlers can't hide the release.
        const disarm = () => {
            window.removeEventListener("pointerup", disarm, true);
            window.removeEventListener("pointercancel", disarm, true);
            if (!dragStarted) dragArmed = false;
        };
        window.addEventListener("pointerup", disarm, true);
        window.addEventListener("pointercancel", disarm, true);
    };

    // Keyboard reorder (ArrowUp/ArrowDown on a row's drag handle). Moves the choice
    // one step within THIS list and persists via actions.onReorderChoices — the same
    // path pointer drag uses on finalize. Each ChoiceList instance (including the
    // nested ones inside a Multi) reorders its own list, so nested reorders bubble
    // through MultiChoiceListItem's nestedActions just like a drag does.
    function moveChoice(choice: IChoice, direction: -1 | 1) {
        if (forceDragDisabled) return; // never persist a filtered/derived list
        const list = stripShadow(choices);
        const index = list.findIndex((c) => c.id === choice.id);
        if (index === -1) return;
        const target = index + direction;
        if (target < 0 || target >= list.length) return; // clamp at the ends
        const next = [...list];
        const [moved] = next.splice(index, 1);
        next.splice(target, 0, moved);
        choices = next;
        actions.onReorderChoices(choices);
    }
</script>

<div
        use:dndzone={{items: choices, dragDisabled, flipDurationMs, morphDisabled: true, useCursorForDetection: true, transformDraggedElement: transformDragPill, dropTargetStyle: {}, dropTargetClasses: isNested ? ["qa-folder-droptarget"] : [], autoAriaDisabled: true, zoneItemTabIndex: -1, delayTouchStart: 200}}
        onconsider={handleConsider}
        onfinalize={handleSort}
        class="choiceList"
        class:qa-nested={isNested}
        class:qa-folder-empty={isEmptyFolder}
        class:qa-empty={choices.length === 0}>
    {#each stripShadow(choices) as choice (choice.id)}
        <!-- Flip wrapper: the dndzone's direct child = the animated/draggable item.
             Must stay margin/padding/border-less (the 12px inter-row margin lives on
             the inner row). data-choice-id stays on the inner row for tests/menus. -->
        <div animate:flip={{ duration: flipDurationMs }}>
            {#if choice.type !== "Multi"}
                <ChoiceListItem
                        {app}
                        roots={roots ?? choices}
                        {dragDisabled}
                        {startDrag}
                        {actions}
                        {choice}
                        onMoveUp={forceDragDisabled ? undefined : () => moveChoice(choice, -1)}
                        onMoveDown={forceDragDisabled ? undefined : () => moveChoice(choice, 1)}
                />
            {:else}
                <MultiChoiceListItem
                        {app}
                        roots={roots ?? choices}
                        {dragDisabled}
                        {startDrag}
                        {actions}
                        {collapseId}
                        {forceDragDisabled}
                        rootReorder={persistRoots}
                        choice={choice as IMultiChoice}
                        onMoveUp={forceDragDisabled ? undefined : () => moveChoice(choice, -1)}
                        onMoveDown={forceDragDisabled ? undefined : () => moveChoice(choice, 1)}
                />
            {/if}
        </div>
    {/each}
</div>

<style>
.choiceList {
    width: auto;
}

.choiceList.qa-nested {
    /* Own the 12px name->first-row gap so the empty drop band sits the same distance
       below the folder name as a populated folder's first row (collapses with the
       row's own margin-top, so populated folders look identical). */
    margin-top: 12px;
    position: relative; /* anchor the ring (::before) */
    border-radius: var(--radius-m);
    transition: background-color 120ms ease;
}

/* The drop ring is drawn a few px OUTSIDE the content as an absolutely-positioned
   ::before (adds no layout) — "synthetically" bigger than the rows so it doesn't
   clamp straight against the choice names. The right edge stays at the content edge:
   the settings pane is overflow-x:hidden, so extending the ring right would clip it. */
.choiceList.qa-nested::before {
    content: "";
    position: absolute;
    inset: -4px 0 -4px -6px;
    border-radius: var(--radius-m);
    border: 2px dashed transparent;
    pointer-events: none;
    transition: border-color 120ms ease;
}

.choiceList.qa-nested:global(.qa-folder-droptarget) {
    background-color: var(--background-modifier-hover);
}

.choiceList.qa-nested:global(.qa-folder-droptarget)::before {
    border-color: var(--interactive-accent);
}

/* Empty folder: a GENEROUS, STABLE drop target. The band is sized by the folder's
   PERSISTED emptiness (qa-folder-empty), NOT the live `choices` length — so when a
   dragged item is previewed into the zone (filling `choices`, toggling qa-empty off)
   the band keeps its height instead of collapsing/expanding under the cursor (the
   "jumps all over the place"). Only persisted-empty folders get it, so populated
   folders never heave at drag start. */
.choiceList.qa-nested.qa-folder-empty {
    min-height: 3rem;
    display: flex;
    align-items: center;
}

/* Hint shows only when the folder is persisted-empty AND nothing is previewed in it
   (qa-empty = live `choices` empty), so it cleanly swaps out for the previewed row
   without changing the band's size. */
.choiceList.qa-nested.qa-folder-empty.qa-empty::after {
    content: "Empty — add a choice or drag one here.";
    color: var(--text-muted);
    font-size: var(--font-ui-smaller, 12px);
    font-style: italic;
    line-height: 1.3;
    padding-left: 2px;
    pointer-events: none;
    user-select: none;
}

@media (prefers-reduced-motion: reduce) {
    .choiceList.qa-nested,
    .choiceList.qa-nested::before {
        transition: none;
    }
}
</style>
