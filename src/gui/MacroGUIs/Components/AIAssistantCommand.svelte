<script lang="ts">
    import ObsidianIcon from "../../components/ObsidianIcon.svelte";
    import {createEventDispatcher} from "svelte";
    import {DndEvent} from "svelte-dnd-action";
	import { IAIAssistantCommand } from "src/types/macros/QuickCommands/IAIAssistantCommand";

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
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <span on:click={() => configureAssistant()} class="clickable">
            <ObsidianIcon iconId="settings" size={16} />
        </span>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <span on:click={() => deleteCommand()} class="clickable">
            <ObsidianIcon iconId="trash-2" size={16} />
        </span>
        <!-- svelte-ignore a11y-no-noninteractive-tabindex -->
        <span on:mousedown={startDrag} on:touchstart={startDrag}
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
