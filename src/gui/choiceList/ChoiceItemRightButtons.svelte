<script lang="ts">
import { createEventDispatcher } from "svelte";

export let dragDisabled: boolean;
export const showConfigureButton: boolean = true;
export const showDuplicateButton: boolean = true;
export const commandEnabled: boolean = false;
export const choiceName: string = "";
const dispatcher = createEventDispatcher();

function _emitDeleteChoice() {
	dispatcher("deleteChoice");
}

function _emitConfigureChoice() {
	dispatcher("configureChoice");
}

function _emitToggleCommand() {
	dispatcher("toggleCommand");
}

function _emitDuplicateChoice() {
	dispatcher("duplicateChoice");
}
</script>

<div class="rightButtonsContainer">
    <div 
        role="button"
        tabindex="0"
        on:click={emitToggleCommand}
        on:keypress={(e) => (e.key === 'Enter' || e.key === ' ') && emitToggleCommand()}
        class="alignIconInDivInMiddle clickable" 
        aria-label={`${commandEnabled ? "Disable in Command Palette" : "Enable in Command Palette"}${choiceName ? ": " + choiceName : ""}`} 
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
         on:pointerdown={() => dispatcher('dragHandleDown')}
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