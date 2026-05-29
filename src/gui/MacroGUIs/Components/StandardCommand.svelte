<script lang="ts">
    import type {ICommand} from "../../../types/macros/ICommand";
    import ObsidianIcon from "../../components/ObsidianIcon.svelte";
    import {getCommandDisplayName} from "../../../utils/macroHelpers";

    let {
        command,
        startDrag,
        dragDisabled,
        onDeleteCommand,
    }: {
        command: ICommand;
        startDrag: (e: MouseEvent | TouchEvent) => void;
        dragDisabled: boolean;
        onDeleteCommand: (commandId: string) => void;
    } = $props();
</script>

<div class="quickAddCommandListItem">
    <li>{getCommandDisplayName(command)}</li>
    <div>
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
