<script lang="ts">
    import IconButton from "../../components/IconButton.svelte";
    import DragHandle from "../../components/DragHandle.svelte";
    import { stopDragInit } from "../../shared/stopDragInit";
    import type {IUserScript} from "../../../types/macros/IUserScript";

    let {
        command,
        fileState,
        startDrag,
        dragDisabled,
        onDeleteCommand,
        onConfigureScript,
        onChooseFile,
        onMoveUp,
        onMoveDown,
    }: {
        command: IUserScript;
        /** Whether `command.path` names a file in the vault. */
        fileState: "ok" | "none" | "missing";
        startDrag: () => void;
        dragDisabled: boolean;
        onDeleteCommand: (commandId: string) => void;
        onConfigureScript: (command: IUserScript) => void;
        onChooseFile: (command: IUserScript) => void;
        onMoveUp?: () => void;
        onMoveDown?: () => void;
    } = $props();
</script>

<li class="quickAddCommandListItem">
    <span class="quickAddCommandText">
        <span class="quickAddCommandLabel">{command.name}</span>
        {#if fileState === "ok"}
            <span class="quickAddCommandDetail" title={command.path}>{command.path}</span>
        {:else if fileState === "none"}
            <span class="quickAddCommandDetail">No file chosen</span>
        {:else}
            <span class="quickAddCommandDetail is-warning" title={command.path}>Can't find {command.path}</span>
        {/if}
    </span>
    <div class="quickAddCommandControls">
        {#if fileState === "ok"}
            <IconButton
                iconId="settings"
                label={`Configure ${command.name}`}
                extraClass="clickable"
                onclick={() => onConfigureScript(command)}
            />
        {:else}
            <button
                type="button"
                aria-label={`Choose file for ${command.name}`}
                onclick={() => onChooseFile(command)}
                use:stopDragInit
            >Choose file</button>
        {/if}
        <IconButton
            iconId="trash-2"
            label={`Delete ${command.name}`}
            extraClass="clickable"
            onclick={() => onDeleteCommand(command.id)}
        />
        <DragHandle
            label={`Reorder ${command.name}`}
            {dragDisabled}
            onDragStart={startDrag}
            {onMoveUp}
            {onMoveDown}
        />
    </div>
</li>
