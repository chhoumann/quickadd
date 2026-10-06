<script lang="ts">
	import ObsidianIcon from "../components/ObsidianIcon.svelte";
	import CapabilityTag from "./CapabilityTag.svelte";
	import type { PackagePreview } from "../../services/packagePreview";

	let { preview, noun = "package" }: { preview: PackagePreview; noun?: "package" | "recipe" } = $props();

	const critical = $derived(preview.summary.hasCritical);
</script>

<!-- Rendered as an Obsidian callout (danger when anything can run code,
     warning otherwise) so it reads like the callouts users already know and
     picks up whatever callout styling their theme applies. Labelled by id, not
     aria-label, which Obsidian would also show as a hover tooltip. -->
<section
	class="callout qa-import-banner"
	data-callout={critical ? "danger" : "warning"}
	aria-labelledby="qa-import-banner-title"
>
	<div class="callout-title">
		<div class="callout-icon">
			<ObsidianIcon iconId={critical ? "zap" : "alert-triangle"} />
		</div>
		<div class="callout-title-inner" id="qa-import-banner-title">
			What this {noun} can do
		</div>
	</div>

	<div class="callout-content">
		<ul class="qa-import-banner-rows">
			{#each preview.capabilityRows as row (row.flag + row.detail)}
				<li>
					<CapabilityTag flag={row.flag} />
					<span class="qa-import-banner-title">{row.title}</span>
					{#if row.detail}
						<span class="qa-import-banner-detail">{row.detail}</span>
					{/if}
				</li>
			{/each}
		</ul>

		<!-- Imported commands are live as soon as the import finishes (both import
		     paths call syncImportedChoiceCommands), so they need no note. A startup
		     macro's automatic run is the one effect that waits: StartupMacroEngine
		     only runs from onload. -->
		{#if preview.summary.runsOnStartup}
			<p class="qa-import-banner-note">
				Importing doesn't run startup macros. They first run the next time
				Obsidian starts or you reload QuickAdd.
			</p>
		{/if}
	</div>
</section>

<style>
	.qa-import-banner {
		margin: 0;
	}

	/* Setting-row text size, so the callout sits level with the cards. */
	.qa-import-banner .callout-content {
		padding-top: var(--size-4-2);
		font-size: var(--font-ui-small);
	}

	.qa-import-banner-rows {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--size-4-2);
	}

	/* The flair is an inline lead-in to the sentence, so long titles wrap
	   full-width under it instead of leaving a dead column beside it. */
	.qa-import-banner-rows li {
		line-height: var(--line-height-tight);
	}

	.qa-import-banner-title {
		margin-inline-start: var(--size-4-1);
	}

	.qa-import-banner-detail {
		display: block;
		margin-top: var(--size-2-1);
		font-size: var(--font-ui-smaller);
		color: var(--text-muted);
		overflow-wrap: anywhere;
	}

	.qa-import-banner-note {
		margin: var(--size-4-3) 0 0;
		font-size: var(--font-ui-smaller);
		color: var(--text-muted);
	}
</style>
