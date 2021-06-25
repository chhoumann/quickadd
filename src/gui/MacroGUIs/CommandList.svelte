<script lang="ts">
    import type {ICommand} from "../../types/macros/ICommand";
    import {DndEvent, dndzone, SOURCES, SHADOW_PLACEHOLDER_ITEM_ID} from "svelte-dnd-action";
    import StandardCommand from "./Components/StandardCommand.svelte";
    import {CommandType} from "../../types/macros/CommandType";
    import WaitCommand from "./Components/WaitCommand.svelte";

    export let commands: ICommand[];
    export let deleteCommand: (command: ICommand) => void;
    export let saveCommands: (commands: ICommand[]) => void;
    let dragDisabled: boolean = true;

    export const updateCommandList: (newCommands: ICommand[]) => void = (newCommands: ICommand[]) => {
        commands = newCommands;
    };

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

        saveCommands(commands);
    }

    let startDrag = (e: CustomEvent<DndEvent>) => {
        e.preventDefault()
        dragDisabled = false;
    }

    function updateCommand(e: any) {
        const command: ICommand = e.detail;

        const index = commands.findIndex(c => c.id === command.id);
        commands[index] = command;
        
        saveCommands(commands);
    }
</script>

<ol class="quickAddCommandList"
    use:dndzone={{items:commands, dragDisabled, dropTargetStyle: {}, type: "command"}}
    on:consider={handleConsider}
    on:finalize={handleSort}
>
    {#each commands.filter(c => c.id !== SHADOW_PLACEHOLDER_ITEM_ID) as command(command.id)}
        {#if command.type === CommandType.Wait}
            <WaitCommand bind:command bind:dragDisabled bind:startDrag={startDrag} on:deleteCommand={e => deleteCommand(e.detail)} on:updateCommand={updateCommand} />
        {:else}
            <StandardCommand bind:command bind:dragDisabled bind:startDrag={startDrag} on:deleteCommand={(e) => deleteCommand(e.detail)} on:updateCommand={updateCommand} />
        {/if}
    {/each}
</ol>

<style>
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
</style>
