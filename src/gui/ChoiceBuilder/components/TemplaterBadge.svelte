<script lang="ts">
import { getIcon } from "obsidian";
import ObsidianIcon from "../../components/ObsidianIcon.svelte";

/** Says that the chosen template runs Templater, or that it needs Templater. */
let { installed }: { installed: boolean } = $props();

// Templater registers its own icon when it loads.
const iconId = getIcon("templater-icon") ? "templater-icon" : "braces";
</script>

<div class="qaTemplaterBadge">
	<span class="qaTemplaterBadgeIcon" aria-hidden="true"><ObsidianIcon {iconId} size={14} /></span>
	<span>
		{#if installed}
			Templater runs after the note is created
		{:else}
			This template uses <a href="obsidian://show-plugin?id=templater-obsidian">Templater</a>, which is not installed
		{/if}
	</span>
</div>

<style>
	.qaTemplaterBadge {
		display: flex;
		align-items: center;
		gap: var(--size-4-1);
		margin: -4px 0 8px;
		font-size: var(--font-ui-smaller);
		color: var(--text-muted);
	}

	.qaTemplaterBadgeIcon {
		display: inline-flex;
	}
</style>
