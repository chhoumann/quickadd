<script lang="ts">
    import IChoice from "../../types/choices/IChoice";
    import ChoiceListItem from "./ChoiceListItem.svelte";
    import MultiChoiceListItem from "./MultiChoiceListItem.svelte";
    import {ChoiceType} from "../../types/choices/choiceType";
    import {DndEvent, dndzone, SHADOW_PLACEHOLDER_ITEM_ID, SOURCES} from "svelte-dnd-action";
    import {createEventDispatcher} from "svelte";

    export let choices: IChoice[] = [];
    let collapseId: string;
    let dragDisabled: boolean = true;

    const dispatcher = createEventDispatcher();

    function emitChoicesReordered() {
        dispatcher('reorderChoices', {choices});
    }

    function handleConsider(e: CustomEvent<DndEvent>) {
        let {items: newItems, info: {id}} = e.detail;
        collapseId = id;

        choices = newItems as IChoice[];
    }

    function handleSort(e: CustomEvent<DndEvent>) {
        let {items: newItems, info: {source}} = e.detail;
        collapseId = "";

        choices = newItems as IChoice[];

        if (source === SOURCES.POINTER) {
            dragDisabled = true;
        }

        emitChoicesReordered();
    }

    function startDrag(e: CustomEvent<DndEvent>) {
        e.preventDefault();
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
        {#if choice.type !== ChoiceType.Multi}
            <ChoiceListItem
                    bind:dragDisabled={dragDisabled}
                    on:mousedown={startDrag}
                    on:touchstart={startDrag}
                    on:deleteChoice
                    on:configureChoice
                    on:toggleCommand
                    on:duplicateChoice
                    bind:choice
            />
        {:else}
            <MultiChoiceListItem
                    bind:dragDisabled={dragDisabled}
                    on:mousedown={startDrag}
                    on:touchstart={startDrag}
                    on:deleteChoice
                    on:configureChoice
                    on:toggleCommand
                    on:duplicateChoice
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