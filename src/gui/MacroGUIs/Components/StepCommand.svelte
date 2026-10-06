<script lang="ts">
	import IconButton from "../../components/IconButton.svelte";
	import DragHandle from "../../components/DragHandle.svelte";
	import StepRowText from "./StepRowText.svelte";

	/** A step with no v2 command form (a link, a Templater run, an open in a view mode). */
	let {
		id,
		name,
		line,
		startDrag,
		dragDisabled,
		onDeleteCommand,
		onConfigure,
		onMoveUp,
		onMoveDown,
	}: {
		id: string;
		name: string;
		line: string | null;
		startDrag: () => void;
		dragDisabled: boolean;
		onDeleteCommand: (commandId: string) => void;
		onConfigure: () => void;
		onMoveUp?: () => void;
		onMoveDown?: () => void;
	} = $props();
</script>

<li class="quickAddCommandListItem">
	<StepRowText {name} {line} />
	<div class="quickAddCommandControls">
		<IconButton
			iconId="settings"
			label={`Configure ${name}`}
			extraClass="clickable"
			onclick={onConfigure}
		/>
		<IconButton
			iconId="trash-2"
			label={`Delete ${name}`}
			extraClass="clickable"
			onclick={() => onDeleteCommand(id)}
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
