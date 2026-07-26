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
	labelFor = undefined,
	control = undefined,
	children = undefined,
}: {
	name?: string;
	/** Plain-text description (matches Obsidian `setDesc(string)` = textContent). */
	desc?: string | undefined;
	/** Renders the heading variant (no control slot). */
	heading?: boolean;
	/**
	 * Id of the control this row labels. Renders the name as a real `<label for>`
	 * instead of a `<div>`, which is what binds a full-width field on the line
	 * below to the name above it (see LabeledField). Opt-in: rows whose control
	 * lives in `control` are already reachable and keep the plain `<div>`.
	 */
	labelFor?: string | undefined;
	/** Control(s) placed in `.setting-item-control`. */
	control?: Snippet | undefined;
	/** Alias for `control` so the row can be used with default slot content. */
	children?: Snippet | undefined;
} = $props();
</script>

<div class="setting-item" class:setting-item-heading={heading}>
	<div class="setting-item-info">
		{#if name}
			{#if labelFor}
				<label class="setting-item-name" for={labelFor}>{name}</label>
			{:else}
				<div class="setting-item-name">{name}</div>
			{/if}
		{/if}
		{#if desc}<div class="setting-item-description">{desc}</div>{/if}
	</div>
	<div class="setting-item-control">
		{@render (control ?? children)?.()}
	</div>
</div>
