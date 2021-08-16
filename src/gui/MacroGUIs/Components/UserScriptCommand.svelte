<script lang="ts">
    import {faTrash, faBars, faCog} from "@fortawesome/free-solid-svg-icons";
    import Icon from "svelte-awesome/components/Icon.svelte";
    import {createEventDispatcher} from "svelte";
    import {DndEvent} from "svelte-dnd-action";
    import {IUserScript} from "../../../types/macros/IUserScript";

    export let command: IUserScript;
    export let startDrag: (e: CustomEvent<DndEvent>) => void;
    export let dragDisabled: boolean;
    const dispatch = createEventDispatcher();

    function deleteCommand() {
        dispatch('deleteCommand', command.id);
    }

    function configureChoice() {
        dispatch('configureScript', command);
    }
</script>

<div class="quickAddCommandListItem">
    <li>{command.name}</li>
    <div>
        <span on:click={() => configureChoice()} class="clickable">
            <Icon data="{faCog}" />
        </span>
        <span on:click={() => deleteCommand()} class="clickable">
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

</style>
