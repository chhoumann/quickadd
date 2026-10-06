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

	// A line that only says the name again ("Runs 'Toggle bold'" under
	// "Toggle bold") adds nothing; one that goes on to say more stays.
	const restatesName = $derived.by(() => {
		// A saved command's name is untrusted: it can be missing or not a string.
		if (line === null || typeof name !== "string" || name.trim() === "") return false;
		const pattern = new RegExp(`(^|['"\\s])${name.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&")}(['"\\s]|$)`, "i");
		if (!pattern.test(line)) return false;
		const rest = line.replace(pattern, " ").replace(/['"]/g, "").trim();
		return rest.split(/\s+/).filter(Boolean).length <= 3;
	});
</script>

<span class="quickAddCommandText">
	<span class="quickAddCommandLabel">{name}</span>
	{#if children}
		{@render children()}
	{:else if line && !restatesName}
		<span class="quickAddCommandDetail" title={line}>{line}</span>
	{/if}
</span>
