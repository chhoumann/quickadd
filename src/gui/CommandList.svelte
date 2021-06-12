<script lang="ts">
    import {faTrash} from "@fortawesome/free-solid-svg-icons";
    import Icon from "svelte-awesome/components/Icon.svelte";
    import type {ICommand} from "../types/macros/ICommand";

    export let commands: ICommand[];
    export let deleteCommand: (command: ICommand) => void;

    export const updateCommandList = (newCommands: ICommand[]) => {
        commands = newCommands;
    }
</script>

<div class="quickAddCommandList">
    {#each commands as command, i}
        <div class="quickAddCommandListItem">
            <span>{i+1}. {command.name}</span>
            <span on:click={() => deleteCommand(command)} class="clickable">
                <Icon data="{faTrash}" />
            </span>
        </div>
    {/each}
</div>

<style>
    .quickAddCommandListItem {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .quickAddCommandList {
        margin-bottom: 8px;
    }

    .clickable {
        cursor: pointer;
    }
</style>
