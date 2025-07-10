<script lang="ts">
    import ObsidianIcon from "../../components/ObsidianIcon.svelte";
    import {createEventDispatcher} from "svelte";
    import type {DndEvent} from "svelte-dnd-action";
	import type { IAIAssistantCommand } from "src/types/macros/QuickCommands/IAIAssistantCommand";

    export let command: IAIAssistantCommand;
    export let startDrag: (e: CustomEvent<DndEvent>) => void;
    export let dragDisabled: boolean;
    const dispatch = createEventDispatcher();

    function deleteCommand() {
        dispatch('deleteCommand', command.id);
    }

    function configureAssistant() {
        dispatch('configureAssistant', command);
    }
</script>

<div class="quickAddCommandListItem">
    <li>{command.name}</li>
    <div>
        <span 
            role="button"
            tabindex="0"
            on:click={() => configureAssistant()}
            on:keypress={(e) => (e.key === 'Enter' || e.key === ' ') && configureAssistant()}
            class="clickable"
        >
            <ObsidianIcon iconId="settings" size={16} />
        </span>
        <span 
            role="button"
            tabindex="0"
            on:click={() => deleteCommand()}
            on:keypress={(e) => (e.key === 'Enter' || e.key === ' ') && deleteCommand()}
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
