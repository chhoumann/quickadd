<script lang="ts">
import ObsidianIcon from "../../components/ObsidianIcon.svelte";

/** A builder's opening line: what the thing it edits does, with its icon. */
let { iconId, text }: { iconId: string; text: string } = $props();
</script>

<div class="qaChoiceSummary">
	<span class="qaChoiceSummaryIcon" aria-hidden="true">
		<ObsidianIcon {iconId} size={18} />
	</span>
	<span class="qaChoiceSummaryText">{text}</span>
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
