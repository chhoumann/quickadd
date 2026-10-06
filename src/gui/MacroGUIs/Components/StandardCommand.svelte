<script lang="ts">
    import type {ICommand} from "../../../types/macros/ICommand";
    import IconButton from "../../components/IconButton.svelte";
    import DragHandle from "../../components/DragHandle.svelte";
    import {getCommandDisplayName} from "../../../utils/macroHelpers";
    import StepRowText from "./StepRowText.svelte";

    let {
        command,
        line,
        startDrag,
        dragDisabled,
        onDeleteCommand,
        onMoveUp,
        onMoveDown,
    }: {
        command: ICommand;
        line: string | null;
        startDrag: () => void;
        dragDisabled: boolean;
        onDeleteCommand: (commandId: string) => void;
        onMoveUp?: () => void;
        onMoveDown?: () => void;
    } = $props();
</script>

<li class="quickAddCommandListItem">
    <StepRowText name={getCommandDisplayName(command)} {line} />
    <div class="quickAddCommandControls">
        <IconButton
            iconId="trash-2"
            label={`Delete ${getCommandDisplayName(command)}`}
            extraClass="clickable"
            onclick={() => onDeleteCommand(command.id)}
        />
        <DragHandle
            label={`Reorder ${getCommandDisplayName(command)}`}
            {dragDisabled}
            onDragStart={startDrag}
            {onMoveUp}
            {onMoveDown}
        />
    </div>
</li>
