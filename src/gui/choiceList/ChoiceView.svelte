<script lang="ts">
	import type { App } from "obsidian";
	import { Notice, Platform, prepareFuzzySearch } from "obsidian";
	import { settingsStore } from "src/settingsStore";
	import { log } from "src/logger/logManager";
	import { tick, untrack } from "svelte";
	import type QuickAdd from "../../main";
	import {
		CommandRegistry,
		configureChoice,
		createChoice,
		createToggleCommandChoice,
		findChoiceById,
		deleteChoiceWithConfirmation,
		duplicateChoiceWithUserScriptSecretSanitization,
		addChoiceToTree,
		insertChoiceAfter,
		moveChoice as moveChoiceService,
		moveChoiceToRoot,
		removeChoiceById,
		setFolderChildrenById,
		setMultiCollapsedById,
	} from "../../services/choiceService";
	import { MOVE_TO_ROOT_TARGET_ID } from "./contextMenu";
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

	// The row passed from the list can be a filtered-view CLONE of a Multi holding
	// only the children that matched the filter (see filterChoices). Resolve the
	// AUTHORITATIVE live choice by id before any edit/duplicate/delete-count, so a
	// folder's hidden children are never dropped or miscounted on save.
	function liveChoice(choice: IChoice): IChoice {
		return findChoiceById(choices, choice.id) ?? choice;
	}

	// True when `choice` or any descendant is command-enabled. Gates command
	// registration when duplicating so a command-less folder never reaches the
	// registry (and so a folder with command-enabled children DOES get them
	// registered via the recursive addCommandForChoice).
	function subtreeHasCommand(choice: IChoice): boolean {
		if (choice.command) return true;
		if (isMultiChoice(choice)) {
			return (choice.choices ?? []).some(subtreeHasCommand);
		}
		return false;
	}

	async function deleteChoice(choice: IChoice) {
		const target = liveChoice(choice);
		const userConfirmed = await deleteChoiceWithConfirmation(target, app);
		if (!userConfirmed) return;

		// Immutable removal at any depth — so the delete is reactive on the runes
		// $state array without relying on the top-array reassignment to heal an
		// in-place nested mutation (which would silently fail for a nested-only delete).
		choices = removeChoiceById(choices, choice.id).updated;
		// Deleting removes the whole subtree, so recursively unregister the
		// commands of any command-enabled descendants too (toggling a folder's
		// own command off, by contrast, must leave its children registered).
		// Use the resolved live `target`, not `choice`: with an active filter the
		// passed `choice` can be a truncated clone (only matching children), which
		// would otherwise leave hidden command-enabled descendants orphaned.
		commandRegistry.disableCommand(target, { recursive: true });
		save();
	}

	async function handleConfigureChoice(oldChoice: IChoice) {
		const live = liveChoice(oldChoice);
		const updatedChoice = await configureChoice(live, app, plugin);
		if (!updatedChoice) return;

		choices = choices.map((choice) => updateChoiceHelper(choice, updatedChoice));
		commandRegistry.updateCommand(live, updatedChoice);
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

		const live = liveChoice(choice);
		const updatedChoice = { ...live, name: newName };
		choices = choices.map((entry) => updateChoiceHelper(entry, updatedChoice));
		commandRegistry.updateCommand(live, updatedChoice);
		save();
	}

	function toggleCommandForChoice(oldChoice: IChoice) {
		const updatedChoice = createToggleCommandChoice(liveChoice(oldChoice));

		choices = choices.map((choice) => updateChoiceHelper(choice, updatedChoice));
		updatedChoice.command
			? commandRegistry.enableCommand(updatedChoice)
			: commandRegistry.disableCommand(updatedChoice);
		save();
	}

	async function handleDuplicateChoice(sourceChoice: IChoice) {
		const newChoice = await duplicateChoiceWithUserScriptSecretSanitization(
			liveChoice(sourceChoice),
			app,
		);
		// Insert the copy right after its source (same parent folder), not at the
		// bottom of the root list — so duplicating a nested row produces a visible,
		// adjacent copy. Fall back to a root append if the source can't be located.
		choices =
			insertChoiceAfter(choices, sourceChoice.id, newChoice) ?? [
				...choices,
				newChoice,
			];
		// A duplicate carries command:true when its source did; register its command so
		// the copy is immediately usable from the palette instead of only appearing
		// command-enabled until the next plugin reload. enableCommand -> addCommandForChoice
		// recurses into a folder's children, so registering once covers any command-enabled
		// descendants too. Gate on the subtree actually containing a command so we never
		// touch the registry for a command-less folder.
		if (subtreeHasCommand(newChoice)) {
			commandRegistry.enableCommand(newChoice);
		}
		save();
		new Notice(`Duplicated "${sourceChoice.name}".`);
		await revealChoice(newChoice.id);
	}

	function handleMoveChoice(choice: IChoice, targetId: string) {
		// The "Move to: (root)" menu item routes through onMove with a sentinel id
		// (no real folder target exists for root), so re-append at the top level.
		choices =
			targetId === MOVE_TO_ROOT_TARGET_ID
				? moveChoiceToRoot(choices, choice.id)
				: moveChoiceService(choices, choice.id, targetId);
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
