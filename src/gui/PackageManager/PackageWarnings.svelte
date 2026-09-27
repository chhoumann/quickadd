<script lang="ts">
	import ObsidianIcon from "../components/ObsidianIcon.svelte";
	import type { PackagePreview } from "../../services/packagePreview";
	let { preview }: { preview: PackagePreview | null } = $props();

	// A missing SCRIPT reference is an execution-hijack risk, not a broken link:
	// it runs from whatever exists at that path. That raises the callout to danger.
	const missingScript = $derived(
		preview?.missingReferences.some((ref) => ref.asScript) ?? false,
	);
</script>

{#if preview && preview.missingReferences.length > 0}
	<section
		class="callout qa-package-callout"
		data-callout={missingScript ? "danger" : "warning"}
	>
		<div class="callout-title">
			<div class="callout-icon">
				<ObsidianIcon iconId={missingScript ? "zap" : "alert-triangle"} />
			</div>
			<div class="callout-title-inner">Missing files</div>
		</div>
		<div class="callout-content">
			<ul>
				{#each preview.missingReferences as ref (ref.path)}
					<li>
						<code>{ref.path}</code>:
						{ref.asScript
							? "not bundled, so it runs from whatever file exists at that path after import"
							: "not bundled and not in your vault"}
						<span class="qa-package-callout-loc">{ref.breadcrumb}</span>
					</li>
				{/each}
			</ul>
		</div>
	</section>
{/if}
{#if preview && preview.orphanAssets.length > 0}
	<section class="callout qa-package-callout" data-callout="info">
		<div class="callout-title">
			<div class="callout-icon">
				<ObsidianIcon iconId="info" />
			</div>
			<div class="callout-title-inner">Unreferenced files</div>
		</div>
		<div class="callout-content">
			<ul>
				{#each preview.orphanAssets as path (path)}
					<li>
						<code>{path}</code>: bundled but not used by any choice
					</li>
				{/each}
			</ul>
		</div>
	</section>
{/if}

<style>
	.qa-package-callout {
		margin: 0;
	}

	.qa-package-callout .callout-content {
		font-size: var(--font-ui-small);
	}

	.qa-package-callout ul {
		margin: var(--size-4-2) 0 0;
		padding-inline-start: var(--size-4-5);
		display: flex;
		flex-direction: column;
		gap: var(--size-4-1);
	}

	.qa-package-callout li {
		overflow-wrap: anywhere;
		line-height: var(--line-height-tight);
	}

	/* Obsidian's inline-code look, which is otherwise scoped to rendered notes. */
	.qa-package-callout code {
		font-family: var(--font-monospace);
		font-size: var(--code-size);
		background-color: var(--code-background);
		border-radius: var(--code-radius);
		padding: 0.1em 0.25em;
	}

	.qa-package-callout-loc {
		display: block;
		color: var(--text-muted);
		font-size: var(--font-ui-smaller);
	}
</style>
