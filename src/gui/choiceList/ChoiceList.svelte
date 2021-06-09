<script lang="ts">
    import Choice from "../../types/choices/choice";
    import ChoiceListItem from "./ChoiceListItem.svelte";
    import MultiChoiceListItem from "./MultiChoiceListItem.svelte";
    import {ChoiceType} from "../../types/choices/choiceType";
    import {DndEvent, dndzone} from "svelte-dnd-action";

    export let choices: Choice[];
    export let type: string;

    function handleSort(e: CustomEvent<DndEvent>) {
        choices = e.detail.items as Choice[];
    }

</script>

<div use:dndzone={{items: choices, dropTargetStyle: {"border": "1px solid black"}}} on:consider={handleSort} on:finalize={handleSort} class="choiceList">
    {#each choices as choice(choice.id)}
        {#if choice.type !== ChoiceType.Multi}
            <ChoiceListItem bind:choice />
        {:else}
            <MultiChoiceListItem id={choice.id} bind:choice />
        {/if}
    {/each}
</div>

<style>
.choiceList {
    width: auto;
    border: 0px solid black;
    overflow-y: auto;
    padding-bottom: 0.5rem;
    height: auto;
    background-color: rgba(100, 100, 100, 0.01);
}
</style>