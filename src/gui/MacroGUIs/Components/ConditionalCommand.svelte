<script lang="ts">
	import ObsidianIcon from "../../components/ObsidianIcon.svelte";
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
	}: {
		command: IConditionalCommand;
		startDrag: (e: MouseEvent | TouchEvent) => void;
		dragDisabled: boolean;
		onDeleteCommand: (commandId: string) => void;
		onConfigureCondition: (command: IConditionalCommand) => void;
		onEditThenBranch: (command: IConditionalCommand) => void;
		onEditElseBranch: (command: IConditionalCommand) => void;
	} = $props();

	const summary = $derived(getConditionSummary(command.condition));
	const thenCount = $derived(command.thenCommands?.length ?? 0);
	const elseCount = $derived(command.elseCommands?.length ?? 0);
</script>

<div class="quickAddCommandListItem conditionalCommand">
	<li>
		<div class="conditionalSummary">{summary}</div>
		<div class="conditionalBranches">
			<span>Then: {thenCount}</span>
			<span>Else: {elseCount}</span>
		</div>
	</li>
	<div>
		<span
			role="button"
			tabindex="0"
			class="clickable"
			onclick={() => onConfigureCondition(command)}
			onkeypress={(e) =>
				(e.key === "Enter" || e.key === " ") && onConfigureCondition(command)}
			aria-label="Edit condition"
		>
			<ObsidianIcon iconId="settings" size={16} />
		</span>
		<span
			role="button"
			tabindex="0"
			class="clickable"
			onclick={() => onEditThenBranch(command)}
			onkeypress={(e) =>
				(e.key === "Enter" || e.key === " ") && onEditThenBranch(command)}
			aria-label="Edit then branch"
		>
			<ObsidianIcon iconId="corner-down-right" size={16} />
		</span>
		<span
			role="button"
			tabindex="0"
			class="clickable"
			onclick={() => onEditElseBranch(command)}
			onkeypress={(e) =>
				(e.key === "Enter" || e.key === " ") && onEditElseBranch(command)}
			aria-label="Edit else branch"
		>
			<ObsidianIcon iconId="corner-down-left" size={16} />
		</span>
		<span
			role="button"
			tabindex="0"
			class="clickable"
			onclick={() => onDeleteCommand(command.id)}
			onkeypress={(e) =>
				(e.key === "Enter" || e.key === " ") && onDeleteCommand(command.id)}
			aria-label="Delete command"
		>
			<ObsidianIcon iconId="trash-2" size={16} />
		</span>
		<span
			role="button"
			onmousedown={startDrag}
			ontouchstart={startDrag}
			class:qa-drag-handle-ready={dragDisabled}
			class:qa-drag-handle-active={!dragDisabled}
			tabindex={dragDisabled ? 0 : -1}
			aria-label="Drag command"
		>
			<ObsidianIcon iconId="grip-vertical" size={16} />
		</span>
	</div>
</div>

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
