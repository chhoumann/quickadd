<script lang="ts">
	import type { Snippet } from "svelte";

	/**
	 * A step row's name, and what the step does under it. `children` takes the
	 * place of the line where the row says something else there.
	 */
	let {
		name,
		line = null,
		children = undefined,
	}: {
		name: string;
		line?: string | null;
		children?: Snippet;
	} = $props();
</script>

<span class="quickAddCommandText">
	<span class="quickAddCommandLabel">{name}</span>
	{#if children}
		{@render children()}
	{:else if line}
		<span class="quickAddCommandDetail" title={line}>{line}</span>
	{/if}
</span>
