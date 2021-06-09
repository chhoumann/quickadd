<script lang="ts">
    import Choice from "../../types/choices/choice";
    import ChoiceListItem from "./ChoiceListItem.svelte";
    import MultiChoiceListItem from "./MultiChoiceListItem.svelte";
    import {ChoiceType} from "../../types/choices/choiceType";

    export let choices: Choice[];
</script>

<div class="choiceList">
    {#each choices as choice, i}
        {#if choice.type !== ChoiceType.Multi}
            <ChoiceListItem bind:choice />
        {:else}
            <MultiChoiceListItem bind:choice />
        {/if}
    {/each}
</div>
