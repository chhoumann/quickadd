<script module lang="ts">
    /** Whether `command.path` names a file a script step can run. */
    export type ScriptFileState = "ok" | "none" | "missing" | "unusable";
</script>

<script lang="ts">
    import IconButton from "../../components/IconButton.svelte";
    import DragHandle from "../../components/DragHandle.svelte";
    import { stopDragInit } from "../../shared/stopDragInit";
    import type {IUserScript} from "../../../types/macros/IUserScript";
    import StepRowText from "./StepRowText.svelte";

    let {
        command,
        line,
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
        line: string | null;
        fileState: ScriptFileState;
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
    <StepRowText name={command.name}>
        {#if fileState === "ok"}
            <!-- What it runs, by the file's name; the path is a hover away. -->
            <span class="quickAddCommandDetail" title={command.path}>{line ?? command.path}</span>
        {:else if fileState === "none"}
            <span class="quickAddCommandDetail">No file chosen</span>
        {:else if fileState === "unusable"}
            <span class="quickAddCommandDetail is-warning" title={command.path}>Not a script: {command.path}</span>
        {:else}
            <span class="quickAddCommandDetail is-warning" title={command.path}>Can't find {command.path}</span>
        {/if}
    </StepRowText>
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
