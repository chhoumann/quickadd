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

    // Old versions saved some nested choices without a name, on the command
    // and on the choice alike; the step then reads by what it does.
    const name = $derived(
        (typeof command.name === "string" && command.name.trim()) ||
            (typeof command.choice?.name === "string" && command.choice.name.trim()) ||
            (command.choice?.type === "Template" ? "Create a note" : command.choice?.type === "Capture" ? "Add to a note" : "Step"),
    );
</script>

<li class="quickAddCommandListItem">
    <StepRowText {name} {line} />
    <div class="quickAddCommandControls">
        <IconButton
            iconId="settings"
            label={`Configure ${name}`}
            extraClass="clickable"
            onclick={() => onConfigureChoice(command)}
        />
        <IconButton
            iconId="trash-2"
            label={`Delete ${name}`}
            extraClass="clickable"
            onclick={() => onDeleteCommand(command.id)}
        />
        <DragHandle
            label={`Reorder ${name}`}
            {dragDisabled}
            onDragStart={startDrag}
            {onMoveUp}
            {onMoveDown}
        />
    </div>
</li>
