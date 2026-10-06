<script lang="ts">
	import InlineMarkdown from "./InlineMarkdown.svelte";
	import type { InlineSegment } from "./inlineMarkdown";

	let { segments }: { segments: InlineSegment[] } = $props();
</script>

{#each segments as segment, index (index)}{#if segment.kind === "text"}{segment.text}{:else if segment.kind === "code"}<code>{segment.text}</code>{:else if segment.kind === "bold"}<strong><InlineMarkdown segments={segment.children} /></strong>{:else if segment.kind === "link"}<a href={segment.href} target="_blank" rel="noopener noreferrer"><InlineMarkdown segments={segment.children} /></a>{/if}{/each}
