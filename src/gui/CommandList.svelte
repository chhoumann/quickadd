<script lang="ts">
    import {faTrash, faBars} from "@fortawesome/free-solid-svg-icons";
    import Icon from "svelte-awesome/components/Icon.svelte";
    import type {ICommand} from "../types/macros/ICommand";
    import {DndEvent, dndzone, SOURCES, SHADOW_PLACEHOLDER_ITEM_ID} from "svelte-dnd-action";

    export let commands: ICommand[];
    export let deleteCommand: (command: ICommand) => void;
    let dragDisabled: boolean = true;

    export const updateCommandList = (newCommands: ICommand[]) => {
        commands = newCommands;
    }

    function handleConsider(e: CustomEvent<DndEvent>) {
        let {items: newItems} = e.detail;
        commands = newItems as ICommand[];
    }

    function handleSort(e: CustomEvent<DndEvent>) {
        let {items: newItems, info: {source}} = e.detail;

        commands = newItems as ICommand[];

        if (source === SOURCES.POINTER) {
            dragDisabled = true;
        }
    }

    function startDrag(e: CustomEvent<DndEvent>) {
        e.preventDefault()
        dragDisabled = false;
    }
</script>

<ol class="quickAddCommandList"
    use:dndzone={{items:commands, dragDisabled, dropTargetStyle: {}, type: "command"}}
    on:consider={handleConsider}
    on:finalize={handleSort}
>
    {#each commands.filter(c => c.id !== SHADOW_PLACEHOLDER_ITEM_ID) as command(command.id)}
        <div class="quickAddCommandListItem">
            <li>{command.name}</li>
            <div>
                <span on:click={() => deleteCommand(command)} class="clickable">
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
    {/each}
</ol>

<style>
    .quickAddCommandListItem {
        display: flex;
        flex: 1 1 auto;
        align-items: center;
        justify-content: space-between;
    }

    .quickAddCommandList {
        display: grid;
        grid-template-columns: auto;
        width: auto;
        border: 0 solid black;
        overflow-y: auto;
        height: auto;
        margin-bottom: 8px;
        padding: 20px;
    }

    .clickable {
        cursor: pointer;
    }
</style>
