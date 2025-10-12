<script lang="ts">
	import { createEventDispatcher } from "svelte";
	import type { DndEvent } from "svelte-dnd-action";
	import ObsidianIcon from "../../components/ObsidianIcon.svelte";
	import type { IConditionalCommand } from "../../../types/macros/Conditional/IConditionalCommand";
	import { getConditionSummary } from "../../../utils/conditionalHelpers";

	export let command: IConditionalCommand;
	export let startDrag: (e: CustomEvent<DndEvent>) => void;
	export let dragDisabled: boolean;

	const dispatch = createEventDispatcher();

	const handleDelete = () => dispatch("deleteCommand", command.id);
	const handleConfigure = () => dispatch("configureCondition", command);
	const handleEditThen = () => dispatch("editThenBranch", command);
	const handleEditElse = () => dispatch("editElseBranch", command);

	$: summary = getConditionSummary(command.condition);
	$: thenCount = command.thenCommands?.length ?? 0;
	$: elseCount = command.elseCommands?.length ?? 0;
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
			on:click={handleConfigure}
			on:keypress={(e) =>
				(e.key === "Enter" || e.key === " ") && handleConfigure()}
			aria-label="Edit condition"
		>
			<ObsidianIcon iconId="settings" size={16} />
		</span>
		<span
			role="button"
			tabindex="0"
			class="clickable"
			on:click={handleEditThen}
			on:keypress={(e) =>
				(e.key === "Enter" || e.key === " ") && handleEditThen()}
			aria-label="Edit then branch"
		>
			<ObsidianIcon iconId="corner-down-right" size={16} />
		</span>
		<span
			role="button"
			tabindex="0"
			class="clickable"
			on:click={handleEditElse}
			on:keypress={(e) =>
				(e.key === "Enter" || e.key === " ") && handleEditElse()}
			aria-label="Edit else branch"
		>
			<ObsidianIcon iconId="corner-down-left" size={16} />
		</span>
		<span
			role="button"
			tabindex="0"
			class="clickable"
			on:click={handleDelete}
			on:keypress={(e) =>
				(e.key === "Enter" || e.key === " ") && handleDelete()}
			aria-label="Delete command"
		>
			<ObsidianIcon iconId="trash-2" size={16} />
		</span>
		<span
			role="button"
			on:mousedown={startDrag}
			on:touchstart={startDrag}
			style="{dragDisabled ? 'cursor: grab' : 'cursor: grabbing'};"
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
