<script lang="ts">
	import ObsidianIcon from "../components/ObsidianIcon.svelte";
	import CapabilityTag from "./CapabilityTag.svelte";
	import type { PackagePreview } from "../../services/packagePreview";

	let { preview }: { preview: PackagePreview } = $props();

	const showReloadNote = $derived(
		preview.summary.runsOnStartup ||
			preview.summary.registersCommandCount > 0,
	);
</script>

<section
	class="qa-import-banner"
	class:critical={preview.summary.hasCritical}
	aria-label="What this package can do"
>
	<div class="qa-import-banner-head">
		<span class="qa-import-banner-icon">
			<ObsidianIcon iconId="alert-triangle" size={17} />
		</span>
		<h3>What this package can do</h3>
	</div>

	<ul class="qa-import-banner-rows">
		{#each preview.capabilityRows as row (row.flag + row.detail)}
			<li
				class:sev-critical={row.severity === "critical"}
				class:sev-warning={row.severity === "warning"}
				class:sev-info={row.severity === "info"}
			>
				<span class="qa-import-banner-tag"
					><CapabilityTag flag={row.flag} /></span
				><span class="qa-import-banner-title">{row.title}</span>
				{#if row.detail}
					<span class="qa-import-banner-detail">{row.detail}</span>
				{/if}
			</li>
		{/each}
	</ul>

	{#if showReloadNote}
		<p class="qa-import-banner-note">
			Takes effect after you reload the plugin or restart Obsidian.
		</p>
	{/if}
</section>

<style>
	.qa-import-banner {
		background: var(--background-secondary);
		border: 1px solid var(--background-modifier-border);
		border-radius: var(--radius-m, 8px);
		padding: 0.85rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	/* Critical packages get a red-tinted hairline + red icon, not a blanket-red
	   fill: severity stays ranked and all text keeps its contrast on the neutral
	   surface. (A solid colored side-stripe would be the banned pattern.) */
	.qa-import-banner.critical {
		border-color: var(--qa-sev-critical-border);
	}

	.qa-import-banner-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.qa-import-banner-icon {
		display: inline-flex;
		color: var(--text-warning, var(--text-muted));
	}

	.qa-import-banner.critical .qa-import-banner-icon {
		color: var(--text-error);
	}

	.qa-import-banner-head h3 {
		margin: 0;
		font-size: 1rem;
	}

	.qa-import-banner-rows {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	/* The pill is an inline lead-in to the sentence (not a fixed left column),
	   so long titles wrap full-width under it instead of leaving a dead column
	   of whitespace beside a one-line pill. */
	.qa-import-banner-rows li {
		display: block;
		padding: 0.4rem 0.5rem;
		border-radius: var(--radius-s, 4px);
	}

	.qa-import-banner-tag {
		display: inline-block;
		vertical-align: middle;
		margin: 0 0.4rem 0.15rem 0;
	}

	/* Faint per-row severity wash so critical rows read hottest while warnings
	   recede, without saturating the whole banner. Composited over the banner
	   surface (not transparent) so the tint is a solid, predictable colour. */
	.qa-import-banner-rows li.sev-critical {
		background: var(--qa-sev-critical-wash);
	}

	.qa-import-banner-rows li.sev-warning {
		background: var(--qa-sev-warning-wash);
	}

	.qa-import-banner-rows li.sev-info {
		background: var(--qa-sev-info-wash);
	}

	.qa-import-banner-title {
		line-height: 1.4;
	}

	.qa-import-banner-detail {
		display: block;
		margin-top: 0.15rem;
		font-size: var(--font-ui-smaller, 0.8rem);
		color: var(--text-muted);
		overflow-wrap: anywhere;
	}

	.qa-import-banner-note {
		margin: 0;
		font-size: var(--font-ui-smaller, 0.8rem);
		color: var(--text-muted);
	}
</style>
