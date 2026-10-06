<script lang="ts">
	import type { App } from "obsidian";
	import { Notice, Platform } from "obsidian";
	import { tick } from "svelte";
	import type IChoice from "../../types/choices/IChoice";
	import type { QuickAddPackage } from "../../types/packages/QuickAddPackage";
	import type { ApplyImportResult } from "../../services/packageImportService";
	import { parseQuickAddPackage } from "../../services/packageImportService";
	import ObsidianIcon from "../components/ObsidianIcon.svelte";
	import PackageReview from "../PackageManager/PackageReview.svelte";
	import { analyseForImport, decisionsWithoutReview, importPackage } from "../PackageManager/packageImport";
	import { describeContents, describeRequirements, filterRecipes, guideUrl, type Recipe } from "./catalog";
	import InlineMarkdown from "./InlineMarkdown.svelte";
	import { parseInline } from "./inlineMarkdown";

	let {
		app,
		recipes,
		setTitle,
		onImported,
	}: {
		app: App;
		recipes: Recipe[];
		setTitle: (title: string) => void;
		/** Called after a recipe is added with the choices as they were before it. */
		onImported: (result: ApplyImportResult, previousChoices: IChoice[]) => void;
	} = $props();

	let query = $state("");
	let added = $state(new Set<string>());
	let adding = $state<string | null>(null);
	// A recipe whose package has something to decide or acknowledge gets the
	// same review a pasted package does.
	let reviewing = $state<{ recipe: Recipe; pkg: QuickAddPackage } | null>(null);
	let filterEl = $state<HTMLInputElement | null>(null);
	let listEl = $state<HTMLElement | null>(null);

	const shown = $derived(filterRecipes(recipes, query));

	$effect(() => {
		// A phone would raise its keyboard over the list.
		if (filterEl && !Platform.isMobile) filterEl.focus();
	});

	function markAdded(recipe: Recipe, result: ApplyImportResult, previousChoices: IChoice[]) {
		onImported(result, previousChoices);
		added = new Set(added).add(recipe.id);
	}

	async function add(recipe: Recipe) {
		adding = recipe.id;
		try {
			// A fresh copy each time: an import may change the package it is given.
			const pkg = parseQuickAddPackage(JSON.stringify(recipe.package));
			const { analysis, preview } = await analyseForImport(app, pkg);
			const decisions = await decisionsWithoutReview(app, analysis, preview);
			if (!decisions) {
				reviewing = { recipe, pkg };
				setTitle(recipe.title);
				return;
			}
			const { result, previousChoices } = await importPackage({ app, pkg, ...decisions });
			markAdded(recipe, result, previousChoices);
		} catch (error) {
			console.error(error);
			new Notice(`Couldn't add ${recipe.title}: ${(error as Error)?.message ?? error}`);
		} finally {
			adding = null;
		}
	}

	async function backToList(recipe: Recipe) {
		reviewing = null;
		setTitle("Recipes");
		await tick();
		listEl?.querySelector(`[data-recipe-id="${CSS.escape(recipe.id)}"]`)?.scrollIntoView({ block: "nearest" });
	}
</script>

{#if reviewing}
	{@const recipe = reviewing.recipe}
	<PackageReview
		{app}
		pkg={reviewing.pkg}
		importLabel="Add recipe"
		noun="recipe"
		keepExistingFiles
		cancelLabel="Back"
		onCancel={() => void backToList(recipe)}
		onDone={() => void backToList(recipe)}
		onImported={(result, previousChoices) => {
			markAdded(recipe, result, previousChoices);
			void backToList(recipe);
		}}
	/>
{:else}
	<div class="qa-recipes">
		<div class="search-input-container qa-recipes-filter">
			<input
				type="search"
				placeholder="Filter recipes..."
				aria-label="Filter recipes"
				bind:value={query}
				bind:this={filterEl}
				autocapitalize="off"
				autocorrect="off"
				spellcheck={false}
				enterkeyhint="search"
			/>
		</div>
		<div class="qa-recipes-list" bind:this={listEl}>
			{#each shown as recipe (recipe.id)}
				{@const isAdded = added.has(recipe.id)}
				{@const requirements = describeRequirements(recipe)}
				<article class="qa-recipe" data-recipe-id={recipe.id} aria-labelledby={`qa-recipe-${recipe.id}`}>
					<div class="qa-recipe-head">
						<h3 class="qa-recipe-title" id={`qa-recipe-${recipe.id}`}>{recipe.title}</h3>
						<div class="qa-recipe-actions">
							<a class="qa-recipe-guide" href={guideUrl(recipe)} target="_blank" rel="noopener noreferrer">Guide</a>
							<button
								type="button"
								class="qa-recipe-add"
								aria-label={isAdded ? `Added ${recipe.title}` : `Add ${recipe.title}`}
								disabled={isAdded || adding !== null}
								onclick={() => void add(recipe)}
							>
								{#if isAdded}
									<ObsidianIcon iconId="check" size={14} />
									<span>Added</span>
								{:else if adding === recipe.id}
									Adding…
								{:else}
									Add
								{/if}
							</button>
						</div>
					</div>
					<p class="qa-recipe-description">{recipe.description}</p>
					<p class="qa-recipe-meta">{describeContents(recipe)}</p>
					{#if requirements}
						<p class="qa-recipe-meta"><InlineMarkdown segments={parseInline(requirements)} /></p>
					{/if}
					{#if isAdded && recipe.afterImport.length > 0}
						<ol class="qa-recipe-next">
							{#each recipe.afterImport as line, index (index)}
								<li><InlineMarkdown segments={parseInline(line)} /></li>
							{/each}
						</ol>
					{/if}
				</article>
			{:else}
				<p class="qa-recipes-empty">No recipes match your filter.</p>
			{/each}
		</div>
	</div>
{/if}

<style>
	.qa-recipes {
		display: flex;
		flex-direction: column;
		gap: var(--size-4-3);
		flex: 1 1 auto;
		min-height: 0;
	}

	.qa-recipes-filter {
		flex: none;
		width: 100%;
	}

	/* The list scrolls under the filter; it reaches the modal's edges so the
	   scrollbar sits there, like the package review's body. */
	.qa-recipes-list {
		display: flex;
		flex-direction: column;
		gap: var(--size-4-2);
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		margin-inline: calc(-1 * var(--size-4-4));
		padding: var(--size-2-1) var(--size-4-4) var(--size-4-2);
		scrollbar-gutter: stable;
	}

	.qa-recipe {
		display: flex;
		flex-direction: column;
		gap: var(--size-2-2);
		flex-shrink: 0;
		padding: var(--size-4-3);
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: var(--radius-m);
	}

	.qa-recipe-head {
		display: flex;
		align-items: flex-start;
		gap: var(--size-4-3);
	}

	.qa-recipe-title {
		flex: 1 1 auto;
		min-width: 0;
		margin: 0;
		font-size: var(--font-ui-medium);
		font-weight: var(--font-semibold);
		line-height: var(--line-height-tight);
		color: var(--text-normal);
	}

	.qa-recipe-actions {
		display: flex;
		align-items: center;
		gap: var(--size-4-3);
		flex: none;
	}

	.qa-recipe-guide {
		font-size: var(--font-ui-small);
		color: var(--text-muted);
		text-decoration: none;
	}

	.qa-recipe-guide:hover {
		color: var(--text-accent);
		text-decoration: underline;
	}

	/* On a phone, as tall as the Add button beside it and wider than its word,
	   so a finger finds it. */
	:global(.is-phone) .qa-recipe-guide {
		display: inline-flex;
		align-items: center;
		align-self: stretch;
		padding-inline: var(--size-4-2);
	}

	/* The ring Obsidian gives a focused link in settings. */
	.qa-recipe :global(a:focus-visible) {
		border-radius: var(--radius-s);
		box-shadow: 0 0 0 2px var(--background-modifier-border-focus);
	}

	.qa-recipe-add {
		display: inline-flex;
		align-items: center;
		gap: var(--size-2-2);
	}

	.qa-recipe-description,
	.qa-recipe-meta {
		margin: 0;
		overflow-wrap: anywhere;
	}

	.qa-recipe-description {
		font-size: var(--font-ui-small);
		color: var(--text-normal);
	}

	.qa-recipe-meta {
		font-size: var(--font-ui-smaller);
		color: var(--text-muted);
	}

	.qa-recipe-next {
		margin: var(--size-2-2) 0 0;
		padding-inline-start: var(--size-4-6);
		font-size: var(--font-ui-small);
		color: var(--text-normal);
		overflow-wrap: anywhere;
	}

	.qa-recipe-next li + li {
		margin-top: var(--size-2-2);
	}

	.qa-recipes-empty {
		margin: var(--size-4-4) 0;
		text-align: center;
		color: var(--text-muted);
	}
</style>
