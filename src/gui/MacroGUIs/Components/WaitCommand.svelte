<script lang="ts">
    import ObsidianIcon from "../../components/ObsidianIcon.svelte";
    import { onMount, untrack } from "svelte";
    import type {IWaitCommand} from "../../../types/macros/QuickCommands/IWaitCommand";

    let {
        command,
        startDrag,
        dragDisabled,
        onDeleteCommand,
        onUpdateCommand,
    }: {
        command: IWaitCommand;
        startDrag: (e: MouseEvent | TouchEvent) => void;
        dragDisabled: boolean;
        onDeleteCommand: (commandId: string) => void;
        onUpdateCommand: (command: IWaitCommand) => void;
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
        time = Number.isNaN(next) ? 0 : next;
        resizeInput();
        onUpdateCommand({ ...command, time });
    }

    onMount(resizeInput);
</script>

<div class="quickAddCommandListItem">
    <li>{command.name} for <input bind:this={inputEl} oninput={onTimeInput} type="number" placeholder="   " value={time} class="dotInput">ms</li>
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
