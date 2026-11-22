<script lang="ts">
	import type { ICommand } from "../../../types/macros/ICommand";
	import IconButton from "../../components/IconButton.svelte";
	import DragHandle from "../../components/DragHandle.svelte";
	import { getCommandDisplayName } from "../../../utils/macroHelpers";

	let {
		command,
		startDrag,
		dragDisabled,
		onDeleteCommand,
		onConfigure,
		onMoveUp,
		onMoveDown,
	}: {
		command: ICommand;
		startDrag: (event: PointerEvent) => void;
		dragDisabled: boolean;
		onDeleteCommand: (commandId: string) => void;
		/** Shows the settings button when the step has something to configure. */
		onConfigure?: () => void;
		onMoveUp?: () => void;
		onMoveDown?: () => void;
	} = $props();

	const name = $derived(getCommandDisplayName(command));
</script>

<li class="quickAddCommandListItem">
	<span class="quickAddCommandLabel">{name}</span>
	<div class="quickAddCommandControls">
		{#if onConfigure}
			<IconButton
				iconId="settings"
				label={`Configure ${name}`}
				extraClass="clickable"
				onclick={onConfigure}
			/>
		{/if}
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
