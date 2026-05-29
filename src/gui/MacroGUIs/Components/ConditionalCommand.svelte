<script lang="ts">
	import IconButton from "../../components/IconButton.svelte";
	import DragHandle from "../../components/DragHandle.svelte";
	import type { IConditionalCommand } from "../../../types/macros/Conditional/IConditionalCommand";
	import { getConditionSummary } from "../../../utils/conditionalHelpers";

	let {
		command,
		startDrag,
		dragDisabled,
		onDeleteCommand,
		onConfigureCondition,
		onEditThenBranch,
		onEditElseBranch,
		onMoveUp,
		onMoveDown,
	}: {
		command: IConditionalCommand;
		startDrag: () => void;
		dragDisabled: boolean;
		onDeleteCommand: (commandId: string) => void;
		onConfigureCondition: (command: IConditionalCommand) => void;
		onEditThenBranch: (command: IConditionalCommand) => void;
		onEditElseBranch: (command: IConditionalCommand) => void;
		onMoveUp?: () => void;
		onMoveDown?: () => void;
	} = $props();

	const summary = $derived(getConditionSummary(command.condition));
	const thenCount = $derived(command.thenCommands?.length ?? 0);
	const elseCount = $derived(command.elseCommands?.length ?? 0);
</script>

<li class="quickAddCommandListItem conditionalCommand">
	<div class="quickAddCommandLabel">
		<div class="conditionalSummary">{summary}</div>
		<div class="conditionalBranches">
			<span>Then: {thenCount}</span>
			<span>Else: {elseCount}</span>
		</div>
	</div>
	<div class="quickAddCommandControls">
		<IconButton
			iconId="settings"
			label={`Edit condition for ${summary}`}
			extraClass="clickable"
			onclick={() => onConfigureCondition(command)}
		/>
		<IconButton
			iconId="corner-down-right"
			label={`Edit then branch for ${summary}`}
			extraClass="clickable"
			onclick={() => onEditThenBranch(command)}
		/>
		<IconButton
			iconId="corner-down-left"
			label={`Edit else branch for ${summary}`}
			extraClass="clickable"
			onclick={() => onEditElseBranch(command)}
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

<style>
	.conditionalCommand {
		flex-wrap: wrap;
	}

	.conditionalSummary {
		font-weight: 600;
		margin-bottom: 4px;
	}

	.conditionalBranches {
		display: flex;
		gap: 12px;
		font-size: 0.9em;
		opacity: 0.8;
	}
</style>
