<script lang="ts">
	import type { IOpenFileCommand } from "../../../types/macros/QuickCommands/IOpenFileCommand";
	import IconButton from "../../components/IconButton.svelte";
	import DragHandle from "../../components/DragHandle.svelte";
	import StepRowText from "./StepRowText.svelte";

	let {
		command,
		line,
		startDrag,
		dragDisabled,
		onDeleteCommand,
		onConfigureOpenFile,
		onMoveUp,
		onMoveDown,
	}: {
		command: IOpenFileCommand;
		line: string | null;
		startDrag: () => void;
		dragDisabled: boolean;
		onDeleteCommand: (commandId: string) => void;
		onConfigureOpenFile: (command: IOpenFileCommand) => void;
		onMoveUp?: () => void;
		onMoveDown?: () => void;
	} = $props();
</script>

<li class="quickAddCommandListItem">
	<StepRowText name={command.name} {line} />
	<div class="quickAddCommandControls">
		<IconButton
			iconId="settings"
			label={`Configure ${command.name}`}
			extraClass="clickable"
			onclick={() => onConfigureOpenFile(command)}
		/>
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
