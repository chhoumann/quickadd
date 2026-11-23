<script lang="ts">
	import type { App } from "obsidian";
	import { Platform } from "obsidian";
	import { settingsStore } from "src/settingsStore";
	import { log } from "src/logger/logManager";
	import { untrack } from "svelte";
	import type { ChoiceBuilderPlugin, ChoiceCommandRegistrar } from "../../types/pluginContext";
	import type IChoice from "../../types/choices/IChoice";
	import ObsidianIcon from "../components/ObsidianIcon.svelte";
	import { DOCS_URLS } from "../../docs";
	import AddChoiceControls from "./AddChoiceControls.svelte";
	import ChoiceList from "./ChoiceList.svelte";
	import ChoicesUnavailable from "./ChoicesUnavailable.svelte";
	import { type Plain } from "../svelte/persist.svelte";

	import { createChoiceViewActions } from "./createChoiceViewActions";
	import { filterChoices, seedChoices } from "./choiceViewTree";

	let {
		app,
		plugin,
		choices = $bindable([]),
		saveChoices,
		openAISettings,
	}: {
		app: App;
		plugin: ChoiceBuilderPlugin & ChoiceCommandRegistrar;
		choices?: IChoice[];
		// Accepts only Plain<IChoice[]> (from snapshot()) — see persist.svelte.ts.
		saveChoices: (choices: Plain<IChoice[]>) => void;
		// Opens Settings → QuickAdd → AI Assistant; the settings tab owns that
		// navigation because this view is mounted inside it.
		openAISettings: () => void;
	} = $props();

	let filterQuery = $state(""); // not persisted

	// The root `choices` is untrusted: loadSettings leaves a non-array in place.
	// Coercing it to [] would show the empty-state CTA that writes over it, so
	// nothing in this view renders or saves while the tree is unreadable.
	const rootUnreadable = $derived(!Array.isArray(choices));
	const rootUnreadableDetail = $derived(
		`The "choices" value in data.json is ${
			choices === null ? "null" : `of type "${typeof choices}"`
		}, but QuickAdd expects a list.`,
	);

	// On mobile the bottom-bar controls fill the width instead of cramming right.
	const isMobile = Platform.isMobile;

	// Reactive mirror of the online gate: the declarative settings tab does not
	// re-mount this view when `disableOnlineFeatures` changes.
	let disableOnlineFeatures = $state(
		settingsStore.getState().disableOnlineFeatures,
	);

	// Keeps the command palette in step with the list (plugin is constant for the
	// component's life; untrack avoids a spurious state_referenced_locally warning).
	const commands: ChoiceCommandRegistrar = untrack(() => plugin);

	choices = seedChoices(choices, commands);

	// Keep choices in sync with external store changes. The subscribe callback runs
	// only on store changes (not during this effect's synchronous setup), so the
	// effect registers no reactive deps and subscribes exactly once.
	$effect(() => {
		const unsubSettingsStore = settingsStore.subscribe((settings) => {
			choices = seedChoices(settings.choices, commands);
			disableOnlineFeatures = settings.disableOnlineFeatures;
		});
		return () => unsubSettingsStore();
	});

	const actions = createChoiceViewActions({
		get app() { return app; },
		get plugin() { return plugin; },
		get choices() { return choices; },
		set choices(value) { choices = value; },
		get filterQuery() { return filterQuery; },
		set filterQuery(value) { filterQuery = value; },
		commands,
		saveChoices: (value) => saveChoices(value),
	});

</script>


<div>
	{#if rootUnreadable}
	<!-- Nothing below this point may run: every branch of the list reads the tree
	     and the add controls would write a new one over it. -->
	<ChoicesUnavailable detail={rootUnreadableDetail} />
	{:else}
	<!-- A throw below would escape mount() and abort the whole settings tab; the
	     boundary keeps the damage inside this view. -->
	<svelte:boundary onerror={(error: unknown) => log.logError(
		`QuickAdd could not render the choice list: ${error instanceof Error ? error.message : String(error)}`,
	)}>
	{#if choices.length === 0 && filterQuery.trim().length === 0}
		<!-- First-run / empty state: the hero is the single focal CTA (the top-bar
		     add controls are not rendered here, so there's no duplicate). -->
		<div class="choiceEmptyState">
			<ObsidianIcon iconId="folder-plus" size={28} />
			<div class="choiceEmptyTitle">No choices yet</div>
			<p class="choiceEmptyBody">
				A choice is an action QuickAdd can run: create a note, capture
				text, or run a macro. Group them with folders.
				<!-- The one place a brand-new user is guaranteed to look, so it
				     carries the plugin's only prominent docs link. -->
				<a
					class="quickadd-docs-link"
					href={DOCS_URLS.gettingStarted}
					target="_blank"
					rel="noopener noreferrer">Learn more</a
				>
			</p>
			<div class="choiceEmptyActions">
				<AddChoiceControls onAddChoice={actions.onAddChoice} />
			</div>
			{#if !disableOnlineFeatures}
				<!-- The bottom bar (and its AI icon) only renders once choices exist,
				     so without this a new user had no way into AI settings. -->
				<button
					type="button"
					class="qaAIAssistantBtn qaAIAssistantEmptyBtn clickable-icon"
					aria-label="Configure AI Assistant"
					onclick={openAISettings}
				>
					<ObsidianIcon iconId="sparkles" size={16} />
					<span>Configure AI Assistant</span>
				</button>
			{/if}
		</div>
	{:else}
		<div class="choiceFilterBar">
			<!-- Obsidian's native search-input treatment: the container class
			     brings the leading magnifier and themed field for free, so the
			     filter reads exactly like search fields elsewhere in the app. -->
			<div class="search-input-container choiceFilterInput">
				<input
					type="search"
					placeholder="Filter choices..."
					bind:value={filterQuery}
					autocapitalize="off"
					autocorrect="off"
					spellcheck={false}
					enterkeyhint="search"
					onkeydown={(e) => {
						if (e.key === 'Escape' && filterQuery) {
							filterQuery = "";
							e.stopPropagation();
						}
					}}
				/>
				{#if filterQuery}
					<button
						class="search-input-clear-button qaFilterClearButton"
						aria-label="Clear filter"
						onclick={() => (filterQuery = "")}
					></button>
				{/if}
			</div>
		</div>

		{#if filterQuery.trim().length === 0}
			<ChoiceList
				{app}
				roots={choices}
				bind:choices
				{actions}
			/>
		{:else}
			{@const filtered = filterChoices(choices, filterQuery)}
			{#if filtered.length === 0}
				<div class="choiceFilterEmpty">
					No choices match your filter.
				</div>
			{:else}
				<ChoiceList
					{app}
					roots={choices}
					choices={filtered}
					forceDragDisabled={true}
					{actions}
				/>
			{/if}
		{/if}

		<div class="choiceViewBottomBar">
			{#if !disableOnlineFeatures}
				<button
					type="button"
					class="qaAIAssistantBtn clickable-icon"
					aria-label="Configure AI Assistant"
					title="Configure AI Assistant"
					onclick={openAISettings}
				>
					<ObsidianIcon iconId="sparkles" size={16} />
				</button>
			{/if}
			<AddChoiceControls onAddChoice={actions.onAddChoice} fill={isMobile} />
		</div>
	{/if}
	{#snippet failed(error: unknown)}
		<ChoicesUnavailable
			detail={error instanceof Error ? error.message : String(error)}
		/>
	{/snippet}
	</svelte:boundary>
	{/if}
</div>

<style>
	.qaAIAssistantEmptyBtn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		margin-top: 0.75rem;
		width: auto;
		color: var(--text-muted);
		font-size: var(--font-ui-small);
	}

	.choiceViewBottomBar {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: flex-end; /* pack right; "New choice" (primary) is the terminal action */
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	/* AI Assistant as a quiet icon button (matches the per-row action icons),
	   leading the right cluster so the bar's width barely changes when AI/online
	   features toggle. */
	.qaAIAssistantBtn {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
	}

	.qaAIAssistantBtn:hover {
		color: var(--text-normal);
	}

	.choiceEmptyState {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 0.5rem;
		padding: 2.5rem 1rem;
		color: var(--text-muted);
	}

	.choiceEmptyTitle {
		font-weight: var(--font-semibold);
		color: var(--text-normal);
	}

	.choiceEmptyBody {
		margin: 0;
		max-width: 42ch;
	}

	.choiceEmptyActions {
		margin-top: 0.5rem;
	}

	.choiceFilterBar {
		margin-bottom: 8px;
	}

	/* The native container is inline-block by default in some contexts; span
	   the full row so the filter aligns with the list edges. */
	.choiceFilterInput {
		width: 100%;
	}

	/* Obsidian styles .search-input-clear-button (position, the × glyph, hover)
	   — we only reset the <button> chrome so that styling shows through. A real
	   <button> (Obsidian uses a div) keeps it keyboard-operable. */
	.qaFilterClearButton {
		background: transparent;
		border: none;
		box-shadow: none;
		padding: 0;
		margin: 0;
		cursor: var(--cursor, pointer);
	}

	.choiceFilterEmpty {
		color: var(--text-faint);
		font-size: var(--font-ui-small, 13px);
		padding: 12px 8px 16px;
	}

</style>
