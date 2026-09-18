<script lang="ts">
	import type { PackagePreview } from "../../services/packagePreview";
	let { preview }: { preview: PackagePreview | null } = $props();
</script>
			{#if preview && (preview.missingReferences.length > 0 || preview.orphanAssets.length > 0)}
				<section class="warningsBand">
					{#if preview.missingReferences.length > 0}
						<div class="warnItem">
							<h4>Missing files</h4>
							<ul>
								{#each preview.missingReferences as ref (ref.path)}
									<li class:script={ref.asScript}>
										<code>{ref.path}</code>:
										{ref.asScript
											? "not bundled, so it runs from whatever file exists at that path after import"
											: "not bundled and not in your vault"}
										<span class="warnLoc"
											>{ref.breadcrumb}</span
										>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
					{#if preview.orphanAssets.length > 0}
						<div class="warnItem">
							<h4>Unreferenced files</h4>
							<ul>
								{#each preview.orphanAssets as path (path)}
									<li>
										<code>{path}</code>: bundled but not
										used by any choice
									</li>
								{/each}
							</ul>
						</div>
					{/if}
				</section>
			{/if}
<style>

	.warningsBand {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--background-modifier-border);
		border-radius: var(--radius-m, 8px);
		padding: 0.6rem 0.75rem;
		gap: 0.5rem;
	}

	.warnItem h4 {
		margin: 0;
		font-size: var(--font-ui-small, 0.9rem);
	}

	.warnItem ul {
		margin: 0.25rem 0 0;
		padding-left: 1rem;
	}

	.warnItem li {
		overflow-wrap: anywhere;
	}

	/* A missing SCRIPT reference is an execution-hijack risk, not a broken
	   link: it runs from whatever exists at that path. Mark it as critical. */
	.warnItem li.script {
		padding: 0.25rem 0.4rem;
		border-radius: var(--radius-s, 4px);
		background: var(--qa-sev-critical-wash);
	}

	.warnLoc {
		color: var(--text-muted);
		font-size: var(--font-ui-smaller, 0.8rem);
	}
</style>
