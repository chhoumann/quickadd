<script lang="ts">
    import ObsidianIcon from "../../components/ObsidianIcon.svelte";
    import type {INestedChoiceCommand} from "../../../types/macros/QuickCommands/INestedChoiceCommand";

    let {
        command,
        startDrag,
        dragDisabled,
        onDeleteCommand,
        onConfigureChoice,
    }: {
        command: INestedChoiceCommand;
        startDrag: (e: MouseEvent | TouchEvent) => void;
        dragDisabled: boolean;
        onDeleteCommand: (commandId: string) => void;
        onConfigureChoice: (command: INestedChoiceCommand) => void;
    } = $props();
</script>

<div class="quickAddCommandListItem">
    <li>{command.name}</li>
    <div>
        <span
            role="button"
            tabindex="0"
            onclick={() => onConfigureChoice(command)}
            onkeypress={(e) => (e.key === 'Enter' || e.key === ' ') && onConfigureChoice(command)}
            class="clickable"
        >
            <ObsidianIcon iconId="settings" size={16} />
        </span>
        <span
            role="button"
            tabindex="0"
            onclick={() => onDeleteCommand(command.id)}
            onkeypress={(e) => (e.key === 'Enter' || e.key === ' ') && onDeleteCommand(command.id)}
            class="clickable"
        >
            <ObsidianIcon iconId="trash-2" size={16} />
        </span>
        <span
              role="button"
              onmousedown={startDrag}
              ontouchstart={startDrag}
              aria-label="Drag-handle"
              class:qa-drag-handle-ready={dragDisabled}
              class:qa-drag-handle-active={!dragDisabled}
              tabindex={dragDisabled ? 0 : -1}
        >
            <ObsidianIcon iconId="grip-vertical" size={16} />
        </span>
    </div>
</div>
