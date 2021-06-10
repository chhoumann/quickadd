<script lang="ts">
    import IChoice from "../../types/choices/IChoice";
    import RightButtons from "./RightButtons.svelte";

    export let choice: IChoice;
    export let dragDisabled: boolean;
</script>

<div class="choiceListItem">
    <span class="choiceListItemName">{choice.name}</span>

    <RightButtons
            on:mousedown
            on:touchstart
            bind:dragDisabled
    />
</div>

<style>
    .choiceListItem {
        display: flex;
        font-size: 16px;
        align-items: center;
        margin: 12px 0 0 0;
        transition: 1000ms ease-in-out;
    }

    .choiceListItemName {
        flex: 1 0 0;
    }
</style>
