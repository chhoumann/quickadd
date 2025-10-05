<script lang="ts">
import { createEventDispatcher, onMount } from "svelte";
import type { DndEvent } from "svelte-dnd-action";
import type { IWaitCommand } from "../../../types/macros/QuickCommands/IWaitCommand";

export let command: IWaitCommand;
export let startDrag: (e: CustomEvent<DndEvent>) => void;
export let dragDisabled: boolean;
const dispatch = createEventDispatcher();

let inputEl: HTMLInputElement;

function _deleteCommand(commandId: string) {
	dispatch("deleteCommand", commandId);
}

function resizeInput() {
	const length: number = inputEl.value.length;
	inputEl.style.width = `${length === 0 ? 2 : length}ch`;
}

onMount(resizeInput);
</script>

<div class="quickAddCommandListItem">
    <li>{command.name} for <input bind:this={inputEl} on:keyup={resizeInput} type="number" placeholder="   " bind:value={command.time} class="dotInput">ms</li>
    <div>
        <span 
            role="button"
            tabindex="0"
            on:click={() => deleteCommand(command.id)}
            on:keypress={(e) => (e.key === 'Enter' || e.key === ' ') && deleteCommand(command.id)}
            class="clickable"
        >
            <ObsidianIcon iconId="trash-2" size={16} />
        </span>
        <span 
              role="button"
              on:mousedown={startDrag} 
              on:touchstart={startDrag}
              aria-label="Drag-handle"
              style="{dragDisabled ? 'cursor: grab' : 'cursor: grabbing'};"
              tabindex={dragDisabled ? 0 : -1}
        >
            <ObsidianIcon iconId="grip-vertical" size={16} />
        </span>
    </div>
</div>

<style lang="css">
.dotInput {
    border: none;
    display: inline;
    font-family: inherit;
    font-size: inherit;
    padding: 0;
    width: 0;
    text-decoration: underline dotted;
    background-color: transparent;
}

.dotInput:hover {
    background-color: transparent;
}
</style>
