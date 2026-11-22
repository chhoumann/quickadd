<script lang="ts">
    import type IChoice from "../../types/choices/IChoice";
    import type IMultiChoice from "../../types/choices/IMultiChoice";
    import ChoiceListItem from "./ChoiceListItem.svelte";
    import MultiChoiceListItem from "./MultiChoiceListItem.svelte";
    import { type DndEvent, dndzone, TRIGGERS } from "svelte-dnd-action";
    import { baseDndOptions, createDropRecovery, keyedItems, showDragPillOnStart, stripShadow } from "../shared/dndReorder";
    import { moveByKeyboard } from "../shared/keyboardReorder";
    import { createDragArming } from "../shared/dragArming.svelte";
    import type { App } from "obsidian";
    import type { ChoiceListActions } from "./choiceListActions";

    let {
        choices = $bindable([]),
        roots,
        app,
        forceDragDisabled = false,
        actions,
        rootReorder,
        isEmptyFolder = false,
        nested = false,
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
        // show/hide was the violent jumping. False/absent at the root level. Stays
        // drag-STABLE because MultiChoiceListItem mounts this list ONE-WAY
        // (`choices={choice.choices}`, not bind:), so the consider-time preview never
        // writes back to choice.choices mid-drag.
        isEmptyFolder?: boolean;
        // Whether this is a folder's inner list (explicit; previously inferred from
        // `rootReorder !== undefined`). Marks ONLY nested zones as drop-into-folder
        // targets and gets the qa-nested ring/band styling — the root list never lights
        // up. False/absent at the root level.
        nested?: boolean;
    } = $props();

    // Everything rendered and handed to the dnd zone (see keyedItems). ChoiceView
    // normalizes the tree first, so this only drops holes.
    const renderable = $derived(keyedItems<IChoice>(choices));

    // Resolve once: at the top level there is no incoming rootReorder, so the list's
    // own handler IS the top-level handler; nested lists receive it explicitly.
    const persistRoots = $derived(rootReorder ?? actions.onReorderChoices);

    let collapseId = $state("");
    // Desktop drag is armed by grabbing the handle (see createDragArming). Mobile: the
    // whole row drags by long-press. Filtering disables both.
    const drag = createDragArming(() => forceDragDisabled);
    const dragDisabled = $derived(drag.disabled);
    let listEl: HTMLDivElement | undefined = $state();

    // Recovers the dragged choice when a drop lands in the placeholder window, which
    // would otherwise commit (and persist) the list without it (#1692). Mouse drags
    // always move enough to close the window; mobile long-press drags start
    // stationary and routinely drop inside it.
    const dropRecovery = createDropRecovery<IChoice>();

    function handleConsider(e: CustomEvent<DndEvent>) {
        if (forceDragDisabled) return; // filtered view: never mutate a derived list
        drag.markStarted(); // a genuine drag is underway (see the arming failsafe)
        const event = e as CustomEvent<DndEvent<IChoice>>;
        showDragPillOnStart(event);
        collapseId = e.detail.info.id;
        // Strip the dnd shadow placeholder so it can't linger and cause ghost gaps
        // (bugs #1244/#883) — see [[svelte-dnd-action-shadow-placeholder]].
        choices = dropRecovery.consider(event);
    }

    function handleSort(e: CustomEvent<DndEvent>) {
        if (forceDragDisabled) return;
        collapseId = "";
        let next = dropRecovery.finalize(e as CustomEvent<DndEvent<IChoice>>);
        const draggedId = e.detail.info.id;
        // Cross-zone de-dupe: on DROPPED_INTO_ANOTHER the dragged item landed in a
        // DIFFERENT zone, yet svelte-dnd can still report it in THIS (source) list — so
        // committing this list verbatim would persist a copy in BOTH the source and the
        // target. Strip the dragged item here so it lives only where it was dropped.
        // CO-DEPENDENT with setFolderChildrenById's by-id commit (choiceTree) — the
        // strip alone is insufficient at depth >= 2; both are load-bearing.
        if (e.detail.info.trigger === TRIGGERS.DROPPED_INTO_ANOTHER) {
            next = next.filter((c) => c.id !== draggedId);
        }
        choices = next;
        // Desktop: disarm so a subsequent row interaction doesn't drag (handle must be
        // grabbed again). Mobile: dragDisabled ignores `armed`, so this is a no-op.
        drag.reset();
        actions.onReorderChoices(choices);
    }

    // Arm the desktop drag on the handle's pointerdown (no-op while filtering). The
    // failsafe that disarms a press-that-never-becomes-a-drag lives in createDragArming.
    let startDrag = () => {
        if (forceDragDisabled) return; // do not enable drag while filtering
        drag.startDrag();
    };

    // Keyboard reorder within THIS list, persisted through actions.onReorderChoices
    // like a drag's finalize, so nested reorders bubble through MultiChoiceListItem's
    // nestedActions too. Cross-zone moves stay mouse-only. `renderable`, not
    // `choices`: stripShadow reads `item.id`, so the raw list would throw on the very
    // hole the render filter exists to hide.
    function moveChoice(choice: IChoice, delta: -1 | 1) {
        if (forceDragDisabled) return; // never persist a filtered/derived list
        moveByKeyboard({
            listEl,
            items: stripShadow(renderable),
            id: choice.id,
            delta,
            describe: (c) => c.name,
            commit: (next) => {
                choices = next;
                actions.onReorderChoices(choices);
            },
        });
    }
</script>

<div
        bind:this={listEl}
        use:dndzone={baseDndOptions({items: renderable, dragDisabled, dropTargetClasses: nested ? ["qa-folder-droptarget"] : []})}
        onconsider={handleConsider}
        onfinalize={handleSort}
        class="choiceList"
        class:qa-nested={nested}
        class:qa-folder-empty={isEmptyFolder}
        class:qa-empty={renderable.length === 0}>
    {#each stripShadow(renderable) as choice (choice.id)}
        <!-- Row wrapper: the dndzone's direct child = the draggable item.
             Must stay margin/padding/border-less (the 2px inter-row margin lives on
             the inner row). data-choice-id stays on the inner row for tests/menus.
             No animate:flip: the zone's flip is 0 ms, so it would move nothing,
             and Svelte's animate measures every row whenever a row leaves. -->
        <div>
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

/* Root (non-nested) empty list keeps a little bottom breathing room. The only way to
   render it empty is a zero-match filter — a truly empty tree shows the hero state. */
.choiceList.qa-empty:not(.qa-nested) {
    padding-bottom: 0.5rem;
}

.choiceList.qa-nested {
    /* Own the 2px name->first-row gap so the empty drop band sits the same distance
       below the folder name as a populated folder's first row (collapses with the
       row's own margin-top, so populated folders look identical). */
    margin-top: 2px;
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
    color: var(--text-faint);
    font-size: var(--font-ui-smaller, 12px);
    line-height: 1.3;
    padding-left: 8px; /* align with the child rows' own left padding */
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
