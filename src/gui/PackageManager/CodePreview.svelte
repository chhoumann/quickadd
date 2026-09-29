<script lang="ts">
	import type { AssetPreviewContent } from "../../services/packagePreview";

	let {
		content,
		label,
		executable,
		wrap = false,
	}: {
		content: AssetPreviewContent;
		/** Accessible name of the code region, e.g. "Contents of scripts/a.js". */
		label: string;
		/** Whether the shown text runs, for the truncation note. */
		executable: boolean;
		/**
		 * Wrap long lines instead of scrolling sideways. For a one-line setting,
		 * where code mid-line would otherwise run out of view.
		 */
		wrap?: boolean;
	} = $props();

	const uid = $props.id();
	const labelId = `${uid}-label`;
</script>

<div class="qa-code-preview">
	{#if content.error}
		<p class="qa-code-preview-note mod-error">
			Preview unavailable: {content.error}
		</p>
	{:else}
		{#if content.looksMinified}
			<p class="qa-code-preview-note mod-warning">
				Minified: cannot be visually reviewed. Import only if you trust
				the source.
			</p>
		{/if}
		<span class="qa-visually-hidden" id={labelId}>{label}</span>
		<!-- Focusable so keyboard users can scroll long scripts. -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<pre
			class="qa-code-preview-code"
			class:mod-wrap={wrap}
			tabindex="0"
			role="region"
			aria-labelledby={labelId}>{content.text}</pre>
		{#if content.truncated}
			<p class="qa-code-preview-note mod-warning">
				Preview truncated. The full {executable
					? "script will run"
					: "file will be imported"}.
			</p>
		{/if}
	{/if}
</div>

<style>
	.qa-code-preview {
		display: flex;
		flex-direction: column;
		gap: var(--size-4-2);
	}

	.qa-code-preview-note {
		margin: 0;
		font-size: var(--font-ui-smaller);
	}

	.qa-code-preview-note.mod-error {
		color: var(--text-error);
	}

	/* Obsidian's code-block look. The card already uses --code-background, so
	   the block sits on the modal background instead to stay distinct. */
	.qa-code-preview-code {
		margin: 0;
		max-height: 240px;
		overflow: auto;
		padding: var(--size-4-3) var(--size-4-4);
		border-radius: var(--code-radius);
		background-color: var(--background-primary);
		color: var(--code-normal);
		font-family: var(--font-monospace);
		font-size: var(--code-size);
		line-height: var(--line-height-normal);
		white-space: pre;
		tab-size: 4;
		user-select: text;
	}

	.qa-code-preview-code.mod-wrap {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.qa-code-preview-code:focus-visible {
		outline: 2px solid var(--background-modifier-border-focus);
		outline-offset: -2px;
	}
</style>
