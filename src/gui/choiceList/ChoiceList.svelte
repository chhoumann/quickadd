<script lang="ts">
    import type IChoice from "../../types/choices/IChoice";
    import type IMultiChoice from "../../types/choices/IMultiChoice";
    import ChoiceListItem from "./ChoiceListItem.svelte";
    import MultiChoiceListItem from "./MultiChoiceListItem.svelte";
    import { type DndEvent, dndzone } from "svelte-dnd-action";
    import { flip } from "svelte/animate";
    import { stripShadow } from "../shared/dndReorder";
    import { Platform, type App } from "obsidian";
    import type { ChoiceListActions } from "./choiceListActions";

    let {
        choices = $bindable([]),
        roots,
        app,
        forceDragDisabled = false,
        actions,
        rootReorder,
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
    const reduceMotion =
        typeof window !== "undefined" &&
        !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // 100ms keeps the position-observation interval at the library floor
    // (max(flip,100)*1.07 ≈ 107ms) so reorder reacts continuously, not in batches,
    // while rows still glide rather than snap.
    const flipDurationMs = reduceMotion ? 0 : 100;

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
        choices = stripShadow(e.detail.items as IChoice[]);
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
        use:dndzone={{items: choices, dragDisabled, flipDurationMs, useCursorForDetection: true, dropTargetStyle: {}, dropTargetClasses: isNested ? ["qa-folder-droptarget"] : [], autoAriaDisabled: true, zoneItemTabIndex: -1, delayTouchStart: 200}}
        onconsider={handleConsider}
        onfinalize={handleSort}
        class="choiceList"
        class:qa-nested={isNested}
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

/* The drop-into-folder ring lives on the ACTUAL dndzone (.choiceList) so the
   highlighted area is EXACTLY the droppable area (what you see is where it drops).
   Reserved at rest (transparent) so a drag only swaps its colour — zero reflow.
   outline-offset is negative (inside the box) because the settings container is
   overflow-x:hidden and a positive offset would clip the ring at the right edge.
   :global() wraps the runtime drop-target class; .choiceList.qa-nested is markup. */
.choiceList.qa-nested {
    border-radius: var(--radius-m);
    outline: 2px dashed transparent;
    outline-offset: -2px;
    transition: outline-color 120ms ease, background-color 120ms ease;
}

.choiceList.qa-nested:global(.qa-folder-droptarget) {
    outline-color: var(--interactive-accent);
    background-color: var(--background-modifier-hover);
}

/* An empty nested folder's drop zone is generous + ALWAYS present (not a thin ~8px
   band that pops in mid-drag), so the ring is an easy, correctly-placed target. */
.choiceList.qa-nested.qa-empty {
    min-height: 2rem;
}

@media (prefers-reduced-motion: reduce) {
    .choiceList.qa-nested {
        transition: none;
    }
}
</style>
