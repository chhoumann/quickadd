<script lang="ts">
import type { Snippet } from "svelte";

/**
 * Obsidian-exact `.setting-item` row, rendered in Svelte so conditional
 * settings can live inside reactive `{#if}` blocks instead of forcing a
 * full modal teardown/rebuild (`reload()`). Emits the same class structure
 * Obsidian core CSS themes (`.setting-item` > `.setting-item-info` >
 * `.setting-item-name` + `.setting-item-description`, `.setting-item-control`),
 * so theming applies with zero plugin CSS. See issue #1130.
 */
let {
	name = undefined,
	desc = undefined,
	heading = false,
	control = undefined,
	children = undefined,
}: {
	name?: string;
	/** Plain-text description (matches Obsidian `setDesc(string)` = textContent). */
	desc?: string | undefined;
	/** Renders the heading variant (no control slot). */
	heading?: boolean;
	/** Control(s) placed in `.setting-item-control`. */
	control?: Snippet | undefined;
	/** Alias for `control` so the row can be used with default slot content. */
	children?: Snippet | undefined;
} = $props();
</script>

<div class="setting-item" class:setting-item-heading={heading}>
	<div class="setting-item-info">
		{#if name}<div class="setting-item-name">{name}</div>{/if}
		{#if desc}<div class="setting-item-description">{desc}</div>{/if}
	</div>
	<div class="setting-item-control">
		{@render control?.()}
		{@render children?.()}
	</div>
</div>
