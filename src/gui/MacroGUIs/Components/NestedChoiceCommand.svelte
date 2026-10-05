<script lang="ts">
    import IconButton from "../../components/IconButton.svelte";
    import DragHandle from "../../components/DragHandle.svelte";
    import StepRowText from "./StepRowText.svelte";
    import type {INestedChoiceCommand} from "../../../types/macros/QuickCommands/INestedChoiceCommand";

    let {
        command,
        line,
        startDrag,
        dragDisabled,
        onDeleteCommand,
        onConfigureChoice,
        onMoveUp,
        onMoveDown,
    }: {
        command: INestedChoiceCommand;
        line: string | null;
        startDrag: () => void;
        dragDisabled: boolean;
        onDeleteCommand: (commandId: string) => void;
        onConfigureChoice: (command: INestedChoiceCommand) => void;
        onMoveUp?: () => void;
        onMoveDown?: () => void;
    } = $props();
</script>

<li class="quickAddCommandListItem">
    <StepRowText name={command.name} {line} />
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
