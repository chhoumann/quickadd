<script lang="ts">
    import IconButton from "../../components/IconButton.svelte";
    import DragHandle from "../../components/DragHandle.svelte";
    import type {INestedChoiceCommand} from "../../../types/macros/QuickCommands/INestedChoiceCommand";

    let {
        command,
        startDrag,
        dragDisabled,
        onDeleteCommand,
        onConfigureChoice,
        onMoveUp,
        onMoveDown,
    }: {
        command: INestedChoiceCommand;
        startDrag: () => void;
        dragDisabled: boolean;
        onDeleteCommand: (commandId: string) => void;
        onConfigureChoice: (command: INestedChoiceCommand) => void;
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
            onclick={() => onConfigureChoice(command)}
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
