<script lang="ts">
    import ObsidianIcon from "../../components/ObsidianIcon.svelte";
    import {createEventDispatcher, onMount} from "svelte";
    import type {IWaitCommand} from "../../../types/macros/QuickCommands/IWaitCommand";

    export let command: IWaitCommand;
    export let startDrag: (e: MouseEvent | TouchEvent) => void;
    export let dragDisabled: boolean;
    const dispatch = createEventDispatcher();

    let inputEl: HTMLInputElement;

    function deleteCommand(commandId: string) {
        dispatch('deleteCommand', commandId);
    }

    function resizeInput() {
        const length: number = inputEl.value.length;
        inputEl.style.setProperty("--qa-wait-input-width", `${length === 0 ? 2 : length}ch`);
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
              class:qa-drag-handle-ready={dragDisabled}
              class:qa-drag-handle-active={!dragDisabled}
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
    width: var(--qa-wait-input-width, 2ch);
    text-decoration: underline dotted;
    background-color: transparent;
}

.dotInput:hover {
    background-color: transparent;
}
</style>
