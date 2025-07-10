<script lang="ts">
    import ObsidianIcon from "../components/ObsidianIcon.svelte";
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
    <div 
        role="button"
        tabindex="0"
        on:click={emitToggleCommand}
        on:keypress={(e) => (e.key === 'Enter' || e.key === ' ') && emitToggleCommand()}
        class="alignIconInDivInMiddle clickable" 
        aria-label={`${commandEnabled ? "Remove" : "Add"} command${choiceName ? " for " + choiceName : ""}`} 
        style={commandEnabled ? "color: #FDD023;" : ""}
    >
        <ObsidianIcon iconId="zap" size={16} />
    </div>
    {#if showConfigureButton}
        <div 
            role="button"
            tabindex="0"
            on:click={emitConfigureChoice}
            on:keypress={(e) => (e.key === 'Enter' || e.key === ' ') && emitConfigureChoice()}
            class="alignIconInDivInMiddle clickable" 
            aria-label={`Configure${choiceName ? " " + choiceName : ""}`}
        >
            <ObsidianIcon iconId="settings" size={16} />
        </div>
    {/if}

    {#if showDuplicateButton}
        <div 
            role="button"
            tabindex="0"
            aria-label={`Duplicate ${choiceName ?? ""}`} 
            class="alignIconInDivInMiddle clickable" 
            on:click={emitDuplicateChoice}
            on:keypress={(e) => (e.key === 'Enter' || e.key === ' ') && emitDuplicateChoice()}
        >
            <ObsidianIcon iconId="copy" size={16} />
        </div>
    {/if}

    <div 
        role="button"
        tabindex="0"
        aria-label={`Delete${choiceName ? " " + choiceName : ""}`} 
        class="alignIconInDivInMiddle clickable" 
        on:click={emitDeleteChoice}
        on:keypress={(e) => (e.key === 'Enter' || e.key === ' ') && emitDeleteChoice()}
    >
        <ObsidianIcon iconId="trash-2" size={16} />
    </div>

    <div 
         role="button"
         tabindex={dragDisabled ? 0 : -1}
         aria-label="Drag-handle"
         style="{dragDisabled ? 'cursor: grab' : 'cursor: grabbing'};"
         class="alignIconInDivInMiddle"
         on:mousedown
         on:touchstart
    >
        <ObsidianIcon iconId="grip-vertical" size={16} />
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