<script lang="ts">
    import ObsidianIcon from "../../components/ObsidianIcon.svelte";
	import type { IAIAssistantCommand } from "src/types/macros/QuickCommands/IAIAssistantCommand";

    let {
        command,
        startDrag,
        dragDisabled,
        onDeleteCommand,
        onConfigureAssistant,
    }: {
        command: IAIAssistantCommand;
        startDrag: (e: MouseEvent | TouchEvent) => void;
        dragDisabled: boolean;
        onDeleteCommand: (commandId: string) => void;
        onConfigureAssistant: (command: IAIAssistantCommand) => void;
    } = $props();
</script>

<div class="quickAddCommandListItem">
    <li>{command.name}</li>
    <div>
        <span
            role="button"
            tabindex="0"
            onclick={() => onConfigureAssistant(command)}
            onkeypress={(e) => (e.key === 'Enter' || e.key === ' ') && onConfigureAssistant(command)}
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
