<script lang="ts">
    import ObsidianIcon from "../components/ObsidianIcon.svelte";

    let {
        dragDisabled,
        showConfigureButton = true,
        showDuplicateButton = true,
        commandEnabled = false,
        choiceName = "",
        onDeleteChoice,
        onConfigureChoice,
        onToggleCommand,
        onDuplicateChoice,
        onDragHandleDown,
    }: {
        dragDisabled: boolean;
        showConfigureButton?: boolean;
        showDuplicateButton?: boolean;
        commandEnabled?: boolean;
        choiceName?: string;
        onDeleteChoice: () => void;
        onConfigureChoice: () => void;
        onToggleCommand: () => void;
        onDuplicateChoice: () => void;
        onDragHandleDown: (e?: Event) => void;
    } = $props();
</script>

<div class="rightButtonsContainer">
    <div
        role="button"
        tabindex="0"
        onclick={onToggleCommand}
        onkeypress={(e) => (e.key === 'Enter' || e.key === ' ') && onToggleCommand()}
        class:command-enabled={commandEnabled}
        class="alignIconInDivInMiddle clickable"
        aria-label={`${commandEnabled ? "Disable in Command Palette" : "Enable in Command Palette"}${choiceName ? ": " + choiceName : ""}`}
    >
        <ObsidianIcon iconId="zap" size={16} />
    </div>
    {#if showConfigureButton}
        <div
            role="button"
            tabindex="0"
            onclick={onConfigureChoice}
            onkeypress={(e) => (e.key === 'Enter' || e.key === ' ') && onConfigureChoice()}
            class="alignIconInDivInMiddle clickable"
            aria-label={`Configure${choiceName ? " " + choiceName : ""}`}
        >
            <ObsidianIcon iconId="settings" size={16} />
        </div>
    {/if}

    {#if showDuplicateButton}
        <div
            role="button"
            tabindex="0"
            aria-label={`Duplicate ${choiceName ?? ""}`}
            class="alignIconInDivInMiddle clickable"
            onclick={onDuplicateChoice}
            onkeypress={(e) => (e.key === 'Enter' || e.key === ' ') && onDuplicateChoice()}
        >
            <ObsidianIcon iconId="copy" size={16} />
        </div>
    {/if}

    <div
        role="button"
        tabindex="0"
        aria-label={`Delete${choiceName ? " " + choiceName : ""}`}
        class="alignIconInDivInMiddle clickable"
        onclick={onDeleteChoice}
        onkeypress={(e) => (e.key === 'Enter' || e.key === ' ') && onDeleteChoice()}
    >
        <ObsidianIcon iconId="trash-2" size={16} />
    </div>

    <div
         role="button"
         tabindex={dragDisabled ? 0 : -1}
         aria-label="Drag-handle"
         class="alignIconInDivInMiddle"
         class:qa-drag-handle-ready={dragDisabled}
         class:qa-drag-handle-active={!dragDisabled}
         onpointerdown={() => onDragHandleDown()}
    >
        <ObsidianIcon iconId="grip-vertical" size={16} />
    </div>
</div>

<style>
.rightButtonsContainer {
    display: flex;
    align-items: center;
    gap: 8px;
}

.clickable:hover {
    cursor: pointer;
}

.alignIconInDivInMiddle {
    display: flex;
    align-items: center;
}

.command-enabled {
    color: var(--text-accent);
}
</style>
