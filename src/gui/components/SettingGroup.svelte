<script lang="ts">
import type { Snippet } from "svelte";

/**
 * Obsidian's `.setting-group`: an optional heading over a card of settings,
 * the markup its own `SettingGroup` builds, so the builder pages' sections look
 * like every other settings page.
 */
let {
	heading = undefined,
	children,
}: {
	heading?: string;
	children: Snippet;
} = $props();
</script>

<div class="setting-group">
	{#if heading}
		<div class="setting-item setting-item-heading">
			<div class="setting-item-name">{heading}</div>
			<div class="setting-item-control"></div>
		</div>
	{/if}
	<div class="setting-items">{@render children()}</div>
</div>
