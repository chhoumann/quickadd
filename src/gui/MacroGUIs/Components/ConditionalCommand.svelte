<script lang="ts">
	import IconButton from "../../components/IconButton.svelte";
	import DragHandle from "../../components/DragHandle.svelte";
	import type { IConditionalCommand } from "../../../types/macros/Conditional/IConditionalCommand";
	import { getConditionSummary } from "../../../utils/conditionalHelpers";
	import StepRowText from "./StepRowText.svelte";

	let {
		command,
		line,
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
		line: string | null;
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
</script>

<li class="quickAddCommandListItem">
	<StepRowText name={summary} {line} />
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

