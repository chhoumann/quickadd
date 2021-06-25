<script lang="ts">
    import {faTrash, faBars} from "@fortawesome/free-solid-svg-icons";
    import Icon from "svelte-awesome/components/Icon.svelte";
    import {createEventDispatcher, onMount} from "svelte";
    import {DndEvent} from "svelte-dnd-action";
    import {IWaitCommand} from "../../../types/macros/QuickCommands/IWaitCommand";

    export let command: IWaitCommand;
    export let startDrag: (e: CustomEvent<DndEvent>) => void;
    export let dragDisabled: boolean;
    const dispatch = createEventDispatcher();

    let inputEl;

    function deleteCommand(commandId: string) {
        dispatch('deleteCommand', commandId);
    }

    function resizeInput() {
        const length: number = inputEl.value.length;
        inputEl.style.width = (length === 0 ? 2 : length) + 'ch';
    }

    onMount(resizeInput);
</script>

<div class="quickAddCommandListItem">
    <li>{command.name} for <input bind:this={inputEl} on:keyup={resizeInput} type="number" placeholder="   " bind:value={command.time} class="dotInput">ms</li>
    <div>
        <span on:click={() => deleteCommand(command.id)} class="clickable">
            <Icon data="{faTrash}" />
        </span>
        <span on:mousedown={startDrag} on:touchstart={startDrag}
              aria-label="Drag-handle"
              style="{dragDisabled ? 'cursor: grab' : 'cursor: grabbing'};"
              tabindex={dragDisabled ? 0 : -1}
        >
            <Icon data={faBars} />
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
