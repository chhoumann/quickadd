<script lang="ts">
    import IChoice from "../../types/choices/IChoice";
    import ChoiceListItem from "./ChoiceListItem.svelte";
    import MultiChoiceListItem from "./MultiChoiceListItem.svelte";
    import {ChoiceType} from "../../types/choices/choiceType";
    import {DndEvent, dndzone, SHADOW_PLACEHOLDER_ITEM_ID} from "svelte-dnd-action";

    export let choices: IChoice[] = [];
    let collapseId: string;

    function handleConsider(e: CustomEvent<DndEvent>) {
        let {items: newItems, info: {id}} = e.detail;
        collapseId = id;

        choices = newItems as IChoice[];
    }

    function handleSort(e: CustomEvent<DndEvent>) {
        let {items: newItems} = e.detail;
        collapseId = "";

        choices = newItems as IChoice[];
    }

</script>

<div
        use:dndzone={{items: choices, dropTargetStyle: {"border": "1px solid black"}}}
        on:consider={handleConsider}
        on:finalize={handleSort}
        class="choiceList"
        style="{choices.length === 0 ? 'padding-bottom: 0.5rem' : ''}">
    {#each choices.filter(c => c.id !== SHADOW_PLACEHOLDER_ITEM_ID) as choice(choice.id)}
        {#if choice.type !== ChoiceType.Multi}
            <ChoiceListItem bind:choice />
        {:else}
            <MultiChoiceListItem bind:collapseId bind:choice />
        {/if}
    {/each}
</div>

<style>
.choiceList {
    width: auto;
    border: 0 solid black;
    overflow-y: auto;
    height: auto;
    background-color: rgba(100, 100, 100, 0.01);
}
</style>