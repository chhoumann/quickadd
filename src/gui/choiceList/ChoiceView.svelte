<script lang="ts">
	import type { App } from "obsidian";
	import { prepareFuzzySearch } from "obsidian";
	import { settingsStore } from "src/settingsStore";
	import { untrack } from "svelte";
	import type QuickAdd from "../../main";
	import {
		CommandRegistry,
		configureChoice,
		createChoice,
		createToggleCommandChoice,
		deleteChoiceWithConfirmation,
		duplicateChoice,
		addChoiceToTree,
		moveChoice as moveChoiceService,
	} from "../../services/choiceService";
	import type { ChoiceType } from "../../types/choices/choiceType";
	import type IChoice from "../../types/choices/IChoice";
	import type IMultiChoice from "../../types/choices/IMultiChoice";
	import { AIAssistantSettingsModal } from "../AIAssistantSettingsModal";
	import ObsidianIcon from "../components/ObsidianIcon.svelte";
	import { promptRenameChoice } from "../choiceRename";
	import AddChoiceControls from "./AddChoiceControls.svelte";
	import ChoiceList from "./ChoiceList.svelte";
	import type { ChoiceListActions } from "./choiceListActions";
	import { type Plain, snapshot } from "../svelte/persist.svelte";

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

	// Keep choices in sync with external store changes. The subscribe callback runs
	// only on store changes (not during this effect's synchronous setup), so the
	// effect registers no reactive deps and subscribes exactly once.
	$effect(() => {
		const unsubSettingsStore = settingsStore.subscribe((settings) => {
			choices = settings.choices;
			disableOnlineFeatures = settings.disableOnlineFeatures;
		});
		return () => unsubSettingsStore();
	});

	// Persist the current choices as a plain (non-proxy) snapshot.
	function save() {
		saveChoices(snapshot(choices));
	}

	const isMultiChoice = (c: IChoice): c is IMultiChoice => c.type === "Multi";

	function filterChoices(list: IChoice[], query: string): IChoice[] {
		const q = query.trim();
		if (!q) return list;
		const match = prepareFuzzySearch(q);

		const walk = (c: IChoice): IChoice | null => {
			const selfMatches = !!match(c.name ?? "");
			if (!isMultiChoice(c)) {
				return selfMatches ? c : null;
			}

			const filteredChildren = (c.choices ?? [])
				.map((child) => walk(child))
				.filter(Boolean) as IChoice[];

			if (selfMatches || filteredChildren.length > 0) {
				// Clone Multi node expanded with only matching children to avoid mutating original
				const expanded: IMultiChoice = {
					...c,
					collapsed: false,
					choices: filteredChildren,
				};
				return expanded;
			}

			return null;
		};

		return list.map((c) => walk(c)).filter(Boolean) as IChoice[];
	}

	async function addChoiceToList(
		name: string,
		type: ChoiceType,
		targetFolderId?: string,
		skipConfigure = false,
	): Promise<void> {
		const newChoice = createChoice(type, name);
		choices = addChoiceToTree(choices, newChoice, targetFolderId);

		// A root-level add while a filter is active would otherwise look like
		// nothing happened (the auto-named choice may not match the filter).
		if (!targetFolderId && filterQuery.trim().length > 0) {
			filterQuery = "";
		}

		// Doers (Template/Capture/Macro) hand off to their builder so the user
		// isn't stranded on an unconfigured row; handleConfigureChoice persists
		// the result, so there's no eager save here (avoids a double write).
		// Folders and Alt-click skip the builder and are committed immediately.
		if (type !== "Multi" && !skipConfigure) {
			try {
				await handleConfigureChoice(newChoice);
			} catch (err) {
				// Builders resolve rather than reject, but don't let a stray throw
				// become an unhandled rejection or lose the new choice.
				console.error("QuickAdd: failed to configure new choice", err);
				save();
			}
		} else {
			save();
		}
	}

	async function deleteChoice(choice: IChoice) {
		const userConfirmed = await deleteChoiceWithConfirmation(choice, app);
		if (!userConfirmed) return;

		// Remove choice from array (including nested choices)
		choices = choices.filter((value) => removeChoiceHelper(choice.id, value));
		commandRegistry.disableCommand(choice);
		save();
	}

	function removeChoiceHelper(id: string, value: IChoice): boolean {
		if (isMultiChoice(value)) {
			value.choices = value.choices.filter((v) => removeChoiceHelper(id, v));
		}
		return value.id !== id;
	}

	async function handleConfigureChoice(oldChoice: IChoice) {
		const updatedChoice = await configureChoice(oldChoice, app, plugin);
		if (!updatedChoice) return;

		choices = choices.map((choice) => updateChoiceHelper(choice, updatedChoice));
		commandRegistry.updateCommand(oldChoice, updatedChoice);
		save();
	}

	function updateChoiceHelper(oldChoice: IChoice, newChoice: IChoice): IChoice {
		if (oldChoice.id === newChoice.id) {
			return { ...oldChoice, ...newChoice };
		}

		if (isMultiChoice(oldChoice)) {
			const updatedChoices = oldChoice.choices.map((c) =>
				updateChoiceHelper(c, newChoice),
			);
			const updated: IMultiChoice = { ...oldChoice, choices: updatedChoices };
			return updated;
		}

		return oldChoice;
	}

	async function handleRenameChoice(choice: IChoice) {
		if (!choice) return;

		const newName = await promptRenameChoice(app, choice.name);
		if (!newName) return;

		const updatedChoice = { ...choice, name: newName };
		choices = choices.map((entry) => updateChoiceHelper(entry, updatedChoice));
		commandRegistry.updateCommand(choice, updatedChoice);
		save();
	}

	function toggleCommandForChoice(oldChoice: IChoice) {
		const updatedChoice = createToggleCommandChoice(oldChoice);

		choices = choices.map((choice) => updateChoiceHelper(choice, updatedChoice));
		updatedChoice.command
			? commandRegistry.enableCommand(updatedChoice)
			: commandRegistry.disableCommand(updatedChoice);
		save();
	}

	function handleDuplicateChoice(sourceChoice: IChoice) {
		const newChoice = duplicateChoice(sourceChoice);
		choices = [...choices, newChoice];
		save();
	}

	function handleMoveChoice(choice: IChoice, targetId: string) {
		choices = moveChoiceService(choices, choice.id, targetId);
		save();
	}

	function handleReorderChoices(reordered: IChoice[]) {
		choices = reordered;
		save();
	}

	const actions: ChoiceListActions = {
		onDeleteChoice: deleteChoice,
		onConfigureChoice: handleConfigureChoice,
		onToggleCommand: toggleCommandForChoice,
		onDuplicateChoice: handleDuplicateChoice,
		onRenameChoice: handleRenameChoice,
		onMoveChoice: handleMoveChoice,
		onReorderChoices: handleReorderChoices,
		onAddChoice: addChoiceToList,
	};

	async function openAISettings() {
		const newSettings = await new AIAssistantSettingsModal(
			app,
			settingsStore.getState().ai,
		).waitForClose;

		if (newSettings) {
			settingsStore.setState((state) => ({ ...state, ai: newSettings }));
		}
	}
</script>


<div>
	{#if choices.length === 0 && filterQuery.trim().length === 0}
		<!-- First-run / empty state: the hero is the single focal CTA (the top-bar
		     add controls are not rendered here, so there's no duplicate). -->
		<div class="choiceEmptyState">
			<ObsidianIcon iconId="folder-plus" size={28} />
			<div class="choiceEmptyTitle">No choices yet</div>
			<p class="choiceEmptyBody">
				A choice is an action QuickAdd can run — create a note, capture
				text, or run a macro. Group them with folders.
			</p>
			<div class="choiceEmptyActions">
				<AddChoiceControls onAddChoice={addChoiceToList} />
			</div>
		</div>
	{:else}
		<div class="choiceViewTopBar">
			<div class="choiceAddGroup">
				<AddChoiceControls onAddChoice={addChoiceToList} />
			</div>
			{#if !disableOnlineFeatures}
				<button class="mod-cta qa-ai-assistant-btn" onclick={openAISettings}
					>AI Assistant</button
				>
			{/if}
		</div>

		<div class="choiceFilterBar">
			<div class="choiceFilterInputWrapper">
				<input
					type="text"
					placeholder="Filter choices (fuzzy)"
					bind:value={filterQuery}
					autocapitalize="off"
					autocorrect="off"
					spellcheck={false}
					onkeydown={(e) => {
						if (e.key === 'Escape' && filterQuery) {
							filterQuery = "";
							e.stopPropagation();
						}
					}}
				/>
				{#if filterQuery}
					<button class="choiceFilterClear" aria-label="Clear filter" title="Clear"
						onclick={() => (filterQuery = "")}
					>
						<ObsidianIcon iconId="x" size={14} />
					</button>
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
			<ChoiceList
				{app}
				roots={choices}
				choices={filterChoices(choices, filterQuery)}
				forceDragDisabled={true}
				{actions}
			/>
		{/if}
	{/if}
</div>

<style>
	.choiceViewTopBar {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}

	/* The add cluster is pinned left (margin-right:auto); the AI button (when
	   shown) sits to its right. The add cluster's position no longer depends on
	   whether the AI button is present, so it can't collapse to the left when
	   AI/online features are disabled. */
	.choiceAddGroup {
		display: flex;
		gap: 0.5rem;
		margin-right: auto;
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
		margin-bottom: 0.5rem;
	}

	.choiceFilterInputWrapper {
		position: relative;
		display: flex;
		align-items: center;
	}

	.choiceFilterInputWrapper input {
		width: 100%;
		padding-right: 1.6rem; /* space for clear button */
	}

	.choiceFilterClear {
		position: absolute;
		right: 4px;
		background: transparent;
		border: none;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 2px;
		color: var(--text-muted);
	}

	.choiceFilterClear:hover {
		color: var(--text-normal);
	}

	@media (max-width: 800px) {
		.choiceViewTopBar {
			flex-direction: column;
			align-items: stretch;
		}

		.choiceAddGroup {
			margin-right: 0;
		}
	}
</style>
