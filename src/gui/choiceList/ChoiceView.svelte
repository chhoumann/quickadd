<script lang="ts">
	import type { App } from "obsidian";
	import { Platform, prepareFuzzySearch } from "obsidian";
	import { settingsStore } from "src/settingsStore";
	import { log } from "src/logger/logManager";
	import { tick, untrack } from "svelte";
	import type QuickAdd from "../../main";
	import {
		CommandRegistry,
		configureChoice,
		createChoice,
		createToggleCommandChoice,
		createToggleShareMenuChoice,
		deleteChoiceWithConfirmation,
		duplicateChoice,
		addChoiceToTree,
		moveChoice as moveChoiceService,
		removeChoiceById,
		setFolderChildrenById,
		setMultiCollapsedById,
	} from "../../services/choiceService";
	import type { ChoiceType } from "../../types/choices/choiceType";
	import type IChoice from "../../types/choices/IChoice";
	import type IMultiChoice from "../../types/choices/IMultiChoice";
	import { AIAssistantSettingsModal } from "../AIAssistantSettingsModal";
	import ObsidianIcon from "../components/ObsidianIcon.svelte";
	import { promptRenameChoice } from "../choiceRename";
	import AddChoiceControls from "./AddChoiceControls.svelte";
	import { uniqueDefaultChoiceName } from "./choiceTypeMeta";
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
		_name: string,
		type: ChoiceType,
		targetFolderId?: string,
		skipConfigure = false,
	): Promise<void> {
		const name = uniqueDefaultChoiceName(type, choices);
		const newChoice = createChoice(type, name);
		choices = addChoiceToTree(choices, newChoice, targetFolderId);

		// A root-level add while a filter is active would otherwise look like
		// nothing happened (the auto-named choice may not match the filter).
		if (!targetFolderId && filterQuery.trim().length > 0) {
			filterQuery = "";
		}

		if (type === "Multi") {
			// Folders have no builder, so commit immediately, then open rename so a
			// fresh "New folder" gets a real name right away (clear feedback +
			// avoids duplicate-name confusion). Cancelling keeps the default name.
			save();
			await handleRenameChoice(newChoice);
			await revealChoice(newChoice.id);
		} else if (!skipConfigure) {
			// Doers hand off to their builder, which both names and configures the
			// choice and persists the result — no eager save (avoids a double write).
			try {
				await handleConfigureChoice(newChoice);
			} catch (err) {
				// Builders resolve rather than reject, but don't let a stray throw
				// become an unhandled rejection or lose the new choice.
				log.logError(
					`Failed to configure the new choice: ${err instanceof Error ? err.message : String(err)}`,
				);
				save();
			}
			await revealChoice(newChoice.id);
		} else {
			// Alt-click: scaffold the doer without opening the builder.
			save();
			await revealChoice(newChoice.id);
		}
	}

	// Scroll a just-added row into view so the add never "looks like nothing
	// happened" (a new root choice otherwise lands at the bottom of a long list
	// while the viewport stays at the top).
	async function revealChoice(id: string): Promise<void> {
		await tick();
		try {
			document
				.querySelector(`[data-choice-id="${id}"]`)
				?.scrollIntoView({ block: "nearest" });
		} catch {
			// jsdom / no-layout environments don't implement scrollIntoView.
		}
	}

	async function deleteChoice(choice: IChoice) {
		const userConfirmed = await deleteChoiceWithConfirmation(choice, app);
		if (!userConfirmed) return;

		// Immutable removal at any depth — so the delete is reactive on the runes
		// $state array without relying on the top-array reassignment to heal an
		// in-place nested mutation (which would silently fail for a nested-only delete).
		choices = removeChoiceById(choices, choice.id).updated;
		commandRegistry.disableCommand(choice);
		save();
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

	// No registry side effect: the share menu is rebuilt live from settings each time
	// the `receive-text-menu` event fires, so persisting the flag is enough (see
	// QuickAdd.registerShareMenu). Reassign immutably so the toggle is reactive.
	function toggleShareMenuForChoice(oldChoice: IChoice) {
		const updatedChoice = createToggleShareMenuChoice(oldChoice);

		choices = choices.map((choice) => updateChoiceHelper(choice, updatedChoice));
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

	// Commit a folder's children by id into ChoiceView's authoritative tree. A nested
	// drag/reorder calls this rather than relying on its (cross-zone-stale) `choice`
	// reference — finding the folder by id keeps the edit on the real live node, which
	// is what fixes the root<->folder drag duplication. See onCommitFolder.
	function handleCommitFolder(folderId: string, children: IChoice[]) {
		choices = setFolderChildrenById(choices, folderId, children);
		save();
	}

	// Reassign the tree immutably (by id, any depth) so the collapse is REACTIVE —
	// an in-place `choice.collapsed = …` isn't tracked until the array is proxied by
	// a reassignment, which is why folders wouldn't toggle on first render. save()
	// also re-seeds choices from the store (proxied), healing reactivity thereafter.
	function handleToggleCollapsed(choice: IChoice) {
		choices = setMultiCollapsedById(
			choices,
			choice.id,
			!(choice as IMultiChoice).collapsed,
		);
		save();
	}

	const actions: ChoiceListActions = {
		onDeleteChoice: deleteChoice,
		onConfigureChoice: handleConfigureChoice,
		onToggleCommand: toggleCommandForChoice,
		onToggleShareMenu: toggleShareMenuForChoice,
		onDuplicateChoice: handleDuplicateChoice,
		onRenameChoice: handleRenameChoice,
		onMoveChoice: handleMoveChoice,
		onReorderChoices: handleReorderChoices,
		onAddChoice: addChoiceToList,
		onToggleCollapsed: handleToggleCollapsed,
		onCommitFolder: handleCommitFolder,
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
			<AddChoiceControls onAddChoice={addChoiceToList} fill={isMobile} />
		</div>
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

</style>
