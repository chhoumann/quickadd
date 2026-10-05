<script lang="ts">
import { settingsStore } from "../../../settingsStore";
import type IChoice from "../../../types/choices/IChoice";
import { resolveChoiceIcon } from "../../../utils/choiceUtils";
import { summarizeChoice } from "../../../v3/choiceSummary";
import ObsidianIcon from "../../components/ObsidianIcon.svelte";

/**
 * What the choice does, in one line at the top of its builder. Reads the
 * whole form's choice, so every edit below rewrites it.
 */
let { choice }: { choice: IChoice } = $props();

const summary = $derived(
	summarizeChoice($state.snapshot(choice) as IChoice, settingsStore.getState().choices),
);
</script>

<div class="qaChoiceSummary">
	<span class="qaChoiceSummaryIcon" aria-hidden="true">
		<ObsidianIcon iconId={resolveChoiceIcon(choice)} size={18} />
	</span>
	<span class="qaChoiceSummaryText">{summary}</span>
</div>

<style>
	.qaChoiceSummary {
		display: flex;
		align-items: flex-start;
		gap: var(--size-4-2);
		padding: var(--size-4-2) var(--size-4-3) var(--size-4-4);
		font-size: var(--font-ui-medium);
		line-height: var(--line-height-tight);
		color: var(--text-normal);
	}

	.qaChoiceSummaryIcon {
		display: inline-flex;
		flex: 0 0 auto;
		/* Centred on the first line of the text. */
		height: calc(var(--font-ui-medium) * var(--line-height-tight));
		align-items: center;
		color: var(--text-muted);
	}
</style>
