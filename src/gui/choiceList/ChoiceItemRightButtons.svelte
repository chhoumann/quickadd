<script lang="ts">
    import {faTrash, faBars, faCog} from "@fortawesome/free-solid-svg-icons";
    import Icon from "svelte-awesome/components/Icon.svelte";
    import {createEventDispatcher} from "svelte";

    export let dragDisabled: boolean;
    export let showConfigureButton: boolean = true;
    export let choiceName: string = "";
    const dispatcher = createEventDispatcher();

    function emitDeleteChoice() {
        dispatcher('deleteChoice');
    }

    function emitConfigureChoice() {
        dispatcher('configureChoice');
    }
</script>

<div class="rightButtonsContainer">
    {#if showConfigureButton}
        <div on:click={emitConfigureChoice} class="alignIconInDivInMiddle clickable" aria-label={`Configure${choiceName ? " " + choiceName : ""}`}>
            <Icon data={faCog} />
        </div>
    {/if}

    <div aria-label={`Delete${choiceName ? " " + choiceName : ""}`} class="alignIconInDivInMiddle clickable" on:click={emitDeleteChoice}>
        <Icon data={faTrash} />
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
    gap: 8px;
}

.clickable:hover {
    cursor: pointer;
}

.alignIconInDivInMiddle {
    display: flex;
    align-items: center;
}
</style>