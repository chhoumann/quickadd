<script lang="ts">
	import { Platform } from "obsidian";
	import { SvelteSet } from "svelte/reactivity";
	import { DOCS_URLS } from "../../docs";
	import ObsidianIcon from "../components/ObsidianIcon.svelte";
	import AddChoiceControls from "./AddChoiceControls.svelte";
	import { describeJob, type FirstRunPlan, JOBS, type JobId, planFirstRun, type VaultFacts } from "./firstRun";
	import type { Preset } from "./presets";

	let {
		facts,
		onCreate,
		onAddChoice,
		onAddFolder,
		onBrowseRecipes,
		onImportPackage,
	}: {
		facts: VaultFacts;
		onCreate: (plan: FirstRunPlan) => Promise<void>;
		onAddChoice: (preset: Preset, targetFolderId?: string, skipConfigure?: boolean) => void;
		onAddFolder: (targetFolderId?: string) => void;
		onBrowseRecipes: () => void;
		onImportPackage: () => void;
	} = $props();

	const picked = new SvelteSet<JobId>();
	let creating = $state(false);

	// In the order the cards are offered, whatever order they were clicked in.
	const plan = $derived(planFirstRun(JOBS.filter((job) => picked.has(job.id)).map((job) => job.id), facts));
	const count = $derived(plan.choices.length);
	const createLabel = $derived(
		count === 0 ? "Create choices" : `Create ${count} ${count === 1 ? "choice" : "choices"}`,
	);

	function toggle(id: JobId) {
		if (picked.has(id)) picked.delete(id);
		else picked.add(id);
	}

	async function create() {
		creating = true;
		try {
			await onCreate(plan);
		} finally {
			creating = false;
		}
	}
</script>

<div class="qaFirstRun">
	<h3 class="qaFirstRunTitle" id="qa-first-run-title">What do you do in Obsidian?</h3>
	<div class="qaJobCards" role="group" aria-labelledby="qa-first-run-title">
		{#each JOBS as job (job.id)}
			{@const selected = picked.has(job.id)}
			<button
				type="button"
				class="qaJobCard"
				data-job={job.id}
				class:is-selected={selected}
				aria-pressed={selected}
				onclick={() => toggle(job.id)}
			>
				<span class="qaJobCardIcon"><ObsidianIcon iconId={job.iconId} size={18} /></span>
				<span class="qaJobCardText">
					<span class="qaJobCardTitle">{job.title}</span>
					<span class="qaJobCardDescription">{describeJob(job.id, facts)}</span>
				</span>
				<span class="qaJobCardCheck"><ObsidianIcon iconId={selected ? "check-circle-2" : "circle"} size={18} /></span>
			</button>
		{/each}
	</div>
	<button type="button" class="mod-cta qaCreateChoicesBtn" disabled={count === 0 || creating} onclick={create}>
		{createLabel}
	</button>
	<button type="button" class="qaBrowseRecipesLink" onclick={onBrowseRecipes}>or browse recipes</button>
	<div class="qaFirstRunScratch">
		<AddChoiceControls {onAddChoice} {onAddFolder} {onBrowseRecipes} {onImportPackage} primary={false} fill={Platform.isMobile} />
	</div>
	<!-- The one place a brand-new user is guaranteed to look, so it carries the
	     plugin's only prominent docs link (#1541). -->
	<a
		class="quickadd-docs-link qaFirstRunDocs"
		href={DOCS_URLS.gettingStarted}
		target="_blank"
		rel="noopener noreferrer">Learn more</a
	>
</div>

<style>
	.qaFirstRun {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
	}

	.qaFirstRunTitle {
		margin: 0 0 0.25rem;
		color: var(--text-normal);
		font-size: var(--h3-size);
	}

	.qaJobCards {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		width: 100%;
		max-width: 30rem;
	}

	/* A card, not a button: reset Obsidian's button chrome. */
	.qaJobCard {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		height: auto;
		padding: 0.625rem 0.75rem;
		text-align: start;
		white-space: normal;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: var(--radius-m);
		box-shadow: none;
		cursor: var(--cursor);
	}

	/* Touch screens keep :hover on the last card tapped. */
	@media (hover: hover) {
		.qaJobCard:hover {
			background: var(--background-modifier-hover);
		}
	}

	.qaJobCard.is-selected {
		border-color: var(--interactive-accent);
		box-shadow: 0 0 0 1px var(--interactive-accent);
	}

	.qaJobCardIcon {
		display: inline-flex;
		color: var(--text-muted);
	}

	.qaJobCardText {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}

	.qaJobCardTitle {
		color: var(--text-normal);
		font-weight: var(--font-medium);
	}

	.qaJobCardDescription {
		color: var(--text-muted);
		font-size: var(--font-ui-small);
	}

	.qaJobCardCheck {
		display: inline-flex;
		color: var(--text-faint);
	}

	.qaJobCard.is-selected .qaJobCardCheck,
	.qaJobCard.is-selected .qaJobCardIcon {
		color: var(--interactive-accent);
	}

	.qaCreateChoicesBtn {
		margin-top: 0.25rem;
	}

	/* A quiet text link: Create stays the one call to action. */
	.qaBrowseRecipesLink {
		height: auto;
		margin-top: -0.25rem;
		padding: 0.125rem 0.25rem;
		background: transparent;
		border: none;
		box-shadow: none;
		color: var(--text-muted);
		font-size: var(--font-ui-small);
		cursor: var(--cursor);
	}

	.qaBrowseRecipesLink:hover {
		color: var(--text-accent);
		text-decoration: underline;
	}

	.qaFirstRunScratch {
		display: flex;
		justify-content: center;
		width: 100%;
		max-width: 30rem;
	}

	.qaFirstRunDocs {
		font-size: var(--font-ui-small);
	}
</style>
