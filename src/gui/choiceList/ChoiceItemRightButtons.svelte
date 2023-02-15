<script lang="ts">
    import {faTrash, faBars, faCog, faBolt, faClone} from "@fortawesome/free-solid-svg-icons";
    import Icon from "svelte-awesome/components/Icon.svelte";
    import {createEventDispatcher} from "svelte";

    export let dragDisabled: boolean;
    export let showConfigureButton: boolean = true;
    export let showDuplicateButton: boolean = true;
    export let commandEnabled: boolean = false;
    export let choiceName: string = "";
    const dispatcher = createEventDispatcher();

    function emitDeleteChoice() {
        dispatcher('deleteChoice');
    }

    function emitConfigureChoice() {
        dispatcher('configureChoice');
    }

    function emitToggleCommand() {
        dispatcher('toggleCommand');
    }

    function emitDuplicateChoice() {
        dispatcher('duplicateChoice');
    }
</script>

<div class="rightButtonsContainer">
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <div on:click={emitToggleCommand} class="alignIconInDivInMiddle clickable" aria-label={`${commandEnabled ? "Remove" : "Add"} command${choiceName ? " for " + choiceName : ""}`} style={commandEnabled ? "color: #FDD023;" : ""}>
        <Icon data={faBolt} />
    </div>
    {#if showConfigureButton}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <div on:click={emitConfigureChoice} class="alignIconInDivInMiddle clickable" aria-label={`Configure${choiceName ? " " + choiceName : ""}`}>
            <Icon data={faCog} />
        </div>
    {/if}

    {#if showDuplicateButton}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <div aria-label={`Duplicate ${choiceName ?? ""}`} class="alignIconInDivInMiddle clickable" on:click={emitDuplicateChoice}>
            <Icon data={faClone} />
        </div>
    {/if}

    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <div aria-label={`Delete${choiceName ? " " + choiceName : ""}`} class="alignIconInDivInMiddle clickable" on:click={emitDeleteChoice}>
        <Icon data={faTrash} />
    </div>

    <!-- svelte-ignore a11y-no-noninteractive-tabindex -->
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