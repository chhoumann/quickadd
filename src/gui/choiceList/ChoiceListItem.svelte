<script lang="ts">
    import IChoice from "../../types/choices/IChoice";
    import RightButtons from "./ChoiceItemRightButtons.svelte";
    import {createEventDispatcher} from "svelte";

    export let choice: IChoice;
    export let dragDisabled: boolean;
    let showConfigureButton: boolean = true;
    const dispatcher = createEventDispatcher();

    function deleteChoice() {
        dispatcher('deleteChoice', {choiceId: choice.id, choiceName: choice.name});
    }

    function configureChoice() {
        dispatcher('configureChoice', {choice});
    }
</script>

<div class="choiceListItem">
    <span class="choiceListItemName">{choice.name}</span>

    <RightButtons
            on:mousedown
            on:touchstart
            on:deleteChoice={deleteChoice}
            on:configureChoice={configureChoice}
            bind:showConfigureButton
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
