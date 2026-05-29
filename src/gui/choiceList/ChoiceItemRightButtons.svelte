<script lang="ts">
    import IconButton from "../components/IconButton.svelte";
    import DragHandle from "../components/DragHandle.svelte";

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
        onMoveUp,
        onMoveDown,
        onOpenMenu,
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
        onMoveUp?: () => void;
        onMoveDown?: () => void;
        onOpenMenu?: (anchor: HTMLElement) => void;
    } = $props();
</script>

<div class="rightButtonsContainer">
    <IconButton
        iconId="zap"
        ariaPressed={commandEnabled}
        label={`Command palette${choiceName ? ": " + choiceName : ""}`}
        onclick={onToggleCommand}
    />
    {#if showConfigureButton}
        <IconButton
            iconId="settings"
            label={`Configure${choiceName ? " " + choiceName : ""}`}
            onclick={onConfigureChoice}
        />
    {/if}

    {#if showDuplicateButton}
        <IconButton
            iconId="copy"
            label={`Duplicate${choiceName ? " " + choiceName : ""}`}
            onclick={onDuplicateChoice}
        />
    {/if}

    <IconButton
        iconId="trash-2"
        label={`Delete${choiceName ? " " + choiceName : ""}`}
        onclick={onDeleteChoice}
    />

    {#if onOpenMenu}
        <IconButton
            iconId="more-vertical"
            ariaHasPopup="menu"
            label={`More options${choiceName ? " for " + choiceName : ""}`}
            onclick={(e) => onOpenMenu?.(e.currentTarget as HTMLElement)}
        />
    {/if}

    <DragHandle
        label={`Reorder${choiceName ? " " + choiceName : ""}`}
        {dragDisabled}
        onDragStart={onDragHandleDown}
        {onMoveUp}
        {onMoveDown}
    />
</div>

<style>
.rightButtonsContainer {
    display: flex;
    align-items: center;
    gap: 8px;
}
</style>
