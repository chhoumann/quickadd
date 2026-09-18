<script lang="ts">
	import type { App } from "obsidian";
	import { Platform } from "obsidian";
	import { settingsStore } from "src/settingsStore";
	import { log } from "src/logger/logManager";
	import { untrack } from "svelte";
	import type QuickAdd from "../../main";
	import { CommandRegistry } from "../../services/choiceService";
	import type IChoice from "../../types/choices/IChoice";
	import { AIAssistantSettingsModal } from "../AIAssistantSettingsModal";
	import ObsidianIcon from "../components/ObsidianIcon.svelte";
	import { DOCS_URLS } from "../../docs";
	import AddChoiceControls from "./AddChoiceControls.svelte";
	import ChoiceList from "./ChoiceList.svelte";
	import ChoicesUnavailable from "./ChoicesUnavailable.svelte";
	import { reportingHandler } from "../../utils/errorUtils";
	import { type Plain } from "../svelte/persist.svelte";

	import { createChoiceViewActions } from "./createChoiceViewActions";
	import { filterChoices, seedChoices } from "./choiceViewTree";

	let {
		app,
		plugin,
		choices = $bindable([]),
		saveChoices,
	}: {
		app: App;
		plugin: QuickAdd;
		choices?: IChoice[];
		// Accepts only Plain<IChoice[]> (from snapshot()) — see persist.svelte.ts.
		saveChoices: (choices: Plain<IChoice[]>) => void;
	} = $props();

	let filterQuery = $state(""); // not persisted

	// The ROOT `choices` is untrusted too: loadSettings deliberately leaves a
	// non-array value in place rather than replacing it with [] (which the next
	// save would persist). Coercing it to [] here would show the "No choices yet"
	// hero, whose one CTA writes a fresh list straight over it - so refuse to
	// render the list at all instead, which also means nothing in this view can
	// call save() while the tree is unreadable (#1566).
	const rootUnreadable = $derived(!Array.isArray(choices));
	const rootUnreadableDetail = $derived(
		`The "choices" value in data.json is ${
			choices === null ? "null" : `of type "${typeof choices}"`
		}, but QuickAdd expects a list.`,
	);

	// On mobile the bottom-bar controls fill the width instead of cramming right.
	const isMobile = Platform.isMobile;

	// Reactive mirror of the AI/online gate so the "AI Assistant" button below
	// reflects toggles of `disableOnlineFeatures` made in the (now declarative)
	// settings tab live — the old imperative tab re-rendered on every change, the
	// declarative tab does not re-mount this view.
	let disableOnlineFeatures = $state(
		settingsStore.getState().disableOnlineFeatures,
	);

	// Command registry for managing Obsidian commands (plugin is constant for the
	// component's life; untrack avoids a spurious state_referenced_locally warning).
	const commandRegistry = new CommandRegistry(untrack(() => plugin));

	choices = seedChoices(choices, commandRegistry);

	// Keep choices in sync with external store changes. The subscribe callback runs
	// only on store changes (not during this effect's synchronous setup), so the
	// effect registers no reactive deps and subscribes exactly once.
	$effect(() => {
		const unsubSettingsStore = settingsStore.subscribe((settings) => {
			choices = seedChoices(settings.choices, commandRegistry);
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
		commandRegistry,
		saveChoices: (value) => saveChoices(value),
	});

	const openAISettings = reportingHandler(
		"Couldn't open the AI assistant settings",
		async () => {
			const newSettings = await new AIAssistantSettingsModal(
				app,
				settingsStore.getState().ai,
			).waitForClose;

			if (newSettings) {
				settingsStore.setState((state) => ({ ...state, ai: newSettings }));
			}
		},
	);
</script>


<div>
	{#if rootUnreadable}
	<!-- Nothing below this point may run: every branch of the list reads the tree
	     and the add controls would write a new one over it. -->
	<ChoicesUnavailable detail={rootUnreadableDetail} />
	{:else}
	<!-- A throw anywhere below used to escape mount() and abort the whole
	     declarative settings tab, so ONE bad choice cost every QuickAdd setting
	     (#1451, #1566). The boundary keeps that damage inside this view; the
	     try/catch in quickAddSettingsTab.renderChoicesView covers the setup this
	     boundary sits inside. -->
	<svelte:boundary onerror={(error) => log.logError(
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
				     carries the plugin's only prominent docs link (#1541). -->
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
				<!-- AI Assistant is a quiet configure-AI utility — an icon button
				     matching the per-row action icons — leading the right cluster so
				     the bar's width barely changes when AI/online features toggle. -->
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
	{#snippet failed(error)}
		<ChoicesUnavailable
			detail={error instanceof Error ? error.message : String(error)}
		/>
	{/snippet}
	</svelte:boundary>
	{/if}
</div>

<style>
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
