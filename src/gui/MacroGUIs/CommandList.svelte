<script lang="ts">
    import type {ICommand} from "../../types/macros/ICommand";
    import {DndEvent, dndzone, SOURCES, SHADOW_PLACEHOLDER_ITEM_ID} from "svelte-dnd-action";
    import StandardCommand from "./Components/StandardCommand.svelte";

    export let commands: ICommand[];
    export let deleteCommand: (command: ICommand) => void;
    let dragDisabled: boolean = true;

    export let updateCommandList: (commands: ICommand[]) => void;

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

        updateCommandList(commands);
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
        <StandardCommand bind:command bind:dragDisabled bind:startDrag on:deleteCommand={(e) => deleteCommand(e.detail.commandId)} />
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
