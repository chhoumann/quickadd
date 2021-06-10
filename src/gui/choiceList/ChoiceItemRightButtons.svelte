<script lang="ts">
    import {faTrash, faBars} from "@fortawesome/free-solid-svg-icons";
    import Icon from "svelte-awesome/components/Icon.svelte";
    import {createEventDispatcher} from "svelte";

    export let dragDisabled: boolean;
    export let showConfigureButton: boolean = true;
    const dispatcher = createEventDispatcher();

    function emitDeleteChoice() {
        dispatcher('deleteChoice');
    }
</script>

<div class="rightButtonsContainer">
    {#if showConfigureButton}
        <button>Configure</button>
    {/if}

    <div aria-label="Delete choice" class="alignIconInDivInMiddle deleteChoiceButton" on:click={emitDeleteChoice}>
        <Icon style="margin-right: 5px" data={faTrash} />
    </div>

    <div tabindex={dragDisabled ? 0 : -1}
         aria-label="Drag-handle"
         style="{dragDisabled ? 'cursor: grab' : 'cursor: grabbing'};"
         class="alignIconInDivInMiddle"
         on:mousedown
         on:touchstart
    >
        <Icon data={faBars} />
    </div>
</div>

<style>
.rightButtonsContainer {
    display: flex;
    align-items: center;
}

.deleteChoiceButton:hover {
    cursor: pointer;
}

.alignIconInDivInMiddle {
    display: flex;
    align-items: center;
}
</style>