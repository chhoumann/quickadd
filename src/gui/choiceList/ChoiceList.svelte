<script lang="ts">
    import Choice from "../../types/choices/choice";
    import ChoiceListItem from "./ChoiceListItem.svelte";
    import MultiChoiceListItem from "./MultiChoiceListItem.svelte";
    import {ChoiceType} from "../../types/choices/choiceType";
    import {DndEvent, dndzone} from "svelte-dnd-action";

    export let choices: Choice[];
    let collapseId: string;
    
    function handleConsider(e: CustomEvent<DndEvent>) {
        let {items: newItems, info: {id}} = e.detail;
        collapseId = id;

        choices = newItems as Choice[];
    }

    function handleSort(e: CustomEvent<DndEvent>) {
        let {items: newItems} = e.detail;
        collapseId = "";

        choices = newItems as Choice[];
    }

</script>

<div use:dndzone={{items: choices, dropTargetStyle: {"border": "1px solid black"}}} on:consider={handleConsider} on:finalize={handleSort} class="choiceList">
    {#each choices as choice(choice.id)}
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
    padding-bottom: 0.5rem;
    height: auto;
    background-color: rgba(100, 100, 100, 0.01);
}
</style>