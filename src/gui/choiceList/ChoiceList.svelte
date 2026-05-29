<script lang="ts">
    import type IChoice from "../../types/choices/IChoice";
    import type IMultiChoice from "../../types/choices/IMultiChoice";
    import ChoiceListItem from "./ChoiceListItem.svelte";
    import MultiChoiceListItem from "./MultiChoiceListItem.svelte";
    import { type DndEvent, dndzone } from "svelte-dnd-action";
    import { stripShadow } from "../shared/dndReorder";
    import type { App } from "obsidian";
    import type { ChoiceListActions } from "./choiceListActions";

    let {
        choices = $bindable([]),
        roots,
        app,
        forceDragDisabled = false,
        actions,
    }: {
        choices?: IChoice[];
        roots?: IChoice[];
        app: App;
        forceDragDisabled?: boolean;
        actions: ChoiceListActions;
    } = $props();

    let collapseId = $state("");
    let dragDisabled = $state(true);

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
        // Always re-disable dragging when the sort finalizes (choiceList behavior;
        // intentionally NOT the macro list's POINTER-only gate).
        dragDisabled = true;
        actions.onReorderChoices(choices);
    }

    let startDrag = (e?: Event) => {
        if (forceDragDisabled) return; // do not enable drag while filtering
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        dragDisabled = false;
    };
</script>

<div
        use:dndzone={{items: choices, dragDisabled, dropTargetStyle: {}}}
        onconsider={handleConsider}
        onfinalize={handleSort}
        class="choiceList"
        style="{choices.length === 0 ? 'padding-bottom: 0.5rem' : ''}">
    {#each stripShadow(choices) as choice (choice.id)}
        {#if choice.type !== "Multi"}
            <ChoiceListItem
                    {app}
                    roots={roots ?? choices}
                    {dragDisabled}
                    {startDrag}
                    {actions}
                    {choice}
            />
        {:else}
            <MultiChoiceListItem
                    {app}
                    roots={roots ?? choices}
                    {dragDisabled}
                    {startDrag}
                    {actions}
                    {collapseId}
                    choice={choice as IMultiChoice}
            />
        {/if}
    {/each}
</div>

<style>
.choiceList {
    width: auto;
    border: 0 solid black;
    overflow-y: auto;
    height: auto;
}
</style>
