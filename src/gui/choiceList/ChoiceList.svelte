<script lang="ts">
    import type IChoice from "../../types/choices/IChoice";
    import type IMultiChoice from "../../types/choices/IMultiChoice";
    import ChoiceListItem from "./ChoiceListItem.svelte";
    import MultiChoiceListItem from "./MultiChoiceListItem.svelte";
    import { type DndEvent, dndzone } from "svelte-dnd-action";
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

    const isMobile = Platform.isMobile;

    let collapseId = $state("");
    // Desktop: drag is armed by grabbing the handle (dragDisabled until then), which
    // prevents accidental drags when interacting with a row. Mobile: there is no
    // handle — the whole row is draggable by LONG-PRESS (delayTouchStart below), the
    // native mobile reorder gesture — so drag stays enabled unless filtering.
    let dragArmed = $state(false);
    const dragDisabled = $derived(forceDragDisabled || (!isMobile && !dragArmed));

    function handleConsider(e: CustomEvent<DndEvent>) {
        if (forceDragDisabled) return; // filtered view: never mutate a derived list
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
        actions.onReorderChoices(choices);
    }

    let startDrag = () => {
        if (forceDragDisabled) return; // do not enable drag while filtering
        dragArmed = true;
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
        use:dndzone={{items: choices, dragDisabled, dropTargetStyle: {}, autoAriaDisabled: true, zoneItemTabIndex: -1, delayTouchStart: 200}}
        onconsider={handleConsider}
        onfinalize={handleSort}
        class="choiceList"
        style="{choices.length === 0 ? 'padding-bottom: 0.25rem' : ''}">
    {#each stripShadow(choices) as choice (choice.id)}
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
    {/each}
</div>

<style>
.choiceList {
    width: auto;
}
</style>
