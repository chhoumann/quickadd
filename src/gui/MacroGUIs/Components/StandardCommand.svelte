<script lang="ts">
import type { ICommand } from "../../../types/macros/ICommand";
import { createEventDispatcher } from "svelte";
import type { DndEvent } from "svelte-dnd-action";

export let command: ICommand;
export let startDrag: (e: CustomEvent<DndEvent>) => void;
export let dragDisabled: boolean;
const dispatch = createEventDispatcher();

function _deleteCommand(commandId: string) {
	dispatch("deleteCommand", commandId);
}
</script>

<div class="quickAddCommandListItem">
    <li>{getCommandDisplayName(command)}</li>
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

</style>