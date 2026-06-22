<script lang="ts">
    import IconButton from "../../components/IconButton.svelte";
    import DragHandle from "../../components/DragHandle.svelte";
    import { onMount, untrack } from "svelte";
    import type {IWaitCommand} from "../../../types/macros/QuickCommands/IWaitCommand";

    let {
        command,
        startDrag,
        dragDisabled,
        onDeleteCommand,
        onUpdateCommand,
        onMoveUp,
        onMoveDown,
    }: {
        command: IWaitCommand;
        startDrag: () => void;
        dragDisabled: boolean;
        onDeleteCommand: (commandId: string) => void;
        onUpdateCommand: (command: IWaitCommand) => void;
        onMoveUp?: () => void;
        onMoveDown?: () => void;
    } = $props();

    // Local mirror of command.time so the input is component-owned. We can't mutate
    // the host-owned command object through the props bag, so persistence is explicit
    // via onUpdateCommand (mirrors the old bind:value={command.time} on every change).
    let inputEl = $state<HTMLInputElement>();
    // Intentionally seed once from the prop; the input is component-owned thereafter.
    let time = $state(untrack(() => command.time));

    function resizeInput() {
        if (!inputEl) return;
        const length: number = String(inputEl.value).length;
        inputEl.style.setProperty("--qa-wait-input-width", `${length === 0 ? 2 : length}ch`);
    }

    function onTimeInput(e: Event & { currentTarget: HTMLInputElement }) {
        const next = e.currentTarget.valueAsNumber;
        // Coerce NaN (empty/invalid) to 0 and clamp negatives: a negative wait is
        // nonsensical (setTimeout treats it as 0) and the label would read "for -50 ms".
        time = Number.isNaN(next) || next < 0 ? 0 : next;
        resizeInput();
        onUpdateCommand({ ...command, time });
    }

    onMount(resizeInput);
</script>

<li class="quickAddCommandListItem">
    <span class="quickAddCommandLabel">{command.name} for <input bind:this={inputEl} oninput={onTimeInput} type="number" min="0" placeholder="   " value={time} class="dotInput" aria-label="Wait duration in milliseconds">ms</span>
    <div class="quickAddCommandControls">
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

<style lang="css">
.dotInput {
    border: none;
    display: inline;
    font-family: inherit;
    font-size: inherit;
    padding: 0;
    width: var(--qa-wait-input-width, 2ch);
    text-decoration: underline dotted;
    background-color: transparent;
}

.dotInput:hover {
    background-color: transparent;
}
</style>
