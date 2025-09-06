<script lang="ts">
    import type IChoice from "../../types/choices/IChoice";
    import ChoiceListItem from "./ChoiceListItem.svelte";
    import MultiChoiceListItem from "./MultiChoiceListItem.svelte";
    import {dndzone, SHADOW_PLACEHOLDER_ITEM_ID, SOURCES} from "svelte-dnd-action";
    import type {DndEvent} from "svelte-dnd-action";
    import {createEventDispatcher} from "svelte";
    import type { App } from "obsidian";

    export let choices: IChoice[] = [];
    export let roots: IChoice[] | undefined;
    export let app: App;
    let collapseId: string;
    let dragDisabled: boolean = true;

    const dispatcher = createEventDispatcher();

    function emitChoicesReordered() {
        dispatcher('reorderChoices', {choices});
    }

    function handleConsider(e: CustomEvent<DndEvent>) {
        let {items: newItems, info: {id}} = e.detail;
        collapseId = id;

        // Remove internal placeholder item from state to avoid ghost gaps
        const sanitized = (newItems as IChoice[]).filter(
            (it) => it.id !== SHADOW_PLACEHOLDER_ITEM_ID
        );
        choices = sanitized;
    }

    function handleSort(e: CustomEvent<DndEvent>) {
        let {items: newItems} = e.detail;
        collapseId = "";

        // Remove internal placeholder item from state to avoid ghost gaps
        const sanitized = (newItems as IChoice[]).filter(
            (it) => it.id !== SHADOW_PLACEHOLDER_ITEM_ID
        );
        choices = sanitized;

        // Always re-disable dragging when the sort finalizes
        dragDisabled = true;

        emitChoicesReordered();
    }

    function startDrag(e: Event) {
        // prevent focus/selection side-effects before enabling drag
        // @ts-ignore
        if (typeof e?.preventDefault === 'function') e.preventDefault();
        dragDisabled = false;
    }
</script>

<div
        use:dndzone={{items: choices, dragDisabled, dropTargetStyle: {}}}
        on:consider={handleConsider}
        on:finalize={handleSort}
        class="choiceList"
        style="{choices.length === 0 ? 'padding-bottom: 0.5rem' : ''}">
    {#each choices.filter(c => c.id !== SHADOW_PLACEHOLDER_ITEM_ID) as choice(choice.id)}
        {#if choice.type !== "Multi"}
            <ChoiceListItem
                    {app}
                    roots={roots ?? choices}
                    bind:dragDisabled={dragDisabled}
                    on:deleteChoice
                    on:configureChoice
                    on:toggleCommand
                    on:duplicateChoice
                    on:moveChoice
                    startDrag={startDrag}
                    bind:choice
            />
        {:else}
            <MultiChoiceListItem
                    {app}
                    roots={roots ?? choices}
                    bind:dragDisabled={dragDisabled}
                    on:deleteChoice
                    on:configureChoice
                    on:toggleCommand
                    on:duplicateChoice
                    on:moveChoice
                    startDrag={startDrag}
                    bind:collapseId
                    bind:choice
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
