<script lang="ts">
    import IconButton from "../../components/IconButton.svelte";
    import DragHandle from "../../components/DragHandle.svelte";
	import type { IAIAssistantCommand } from "src/types/macros/QuickCommands/IAIAssistantCommand";

    let {
        command,
        startDrag,
        dragDisabled,
        onDeleteCommand,
        onConfigureAssistant,
        onMoveUp,
        onMoveDown,
    }: {
        command: IAIAssistantCommand;
        startDrag: () => void;
        dragDisabled: boolean;
        onDeleteCommand: (commandId: string) => void;
        onConfigureAssistant: (command: IAIAssistantCommand) => void;
        onMoveUp?: () => void;
        onMoveDown?: () => void;
    } = $props();
</script>

<li class="quickAddCommandListItem">
    <span class="quickAddCommandLabel">{command.name}</span>
    <div class="quickAddCommandControls">
        <IconButton
            iconId="settings"
            label={`Configure ${command.name}`}
            extraClass="clickable"
            onclick={() => onConfigureAssistant(command)}
        />
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
