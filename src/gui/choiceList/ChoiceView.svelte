<script lang="ts">
	import type { App } from "obsidian";
	import { prepareFuzzySearch } from "obsidian";
	import { settingsStore } from "src/settingsStore";
	import { onMount } from "svelte";
	import type QuickAdd from "../../main";
	import {
		type ChoiceType,
		CommandRegistry,
		configureChoice,
		createChoice,
		createToggleCommandChoice,
		deleteChoiceWithConfirmation,
		duplicateChoice,
	} from "../../services/choiceService";
	import type IChoice from "../../types/choices/IChoice";
	import { AIAssistantSettingsModal } from "../AIAssistantSettingsModal";
	import ObsidianIcon from "../components/ObsidianIcon.svelte";
	import AddChoiceBox from "./AddChoiceBox.svelte";
	import ChoiceList from "./ChoiceList.svelte";
	import { moveChoice as moveChoiceService } from "../../services/choiceService";

	export let choices: IChoice[] = [];
	export let saveChoices: (choices: IChoice[]) => void;
	export let app: App;
	export let plugin: QuickAdd;

	let filterQuery: string = ""; // not persisted

	function filterChoices(list: IChoice[], query: string): IChoice[] {
		const q = query.trim();
		if (!q) return list;
		const match = prepareFuzzySearch(q);

		const walk = (c: IChoice): IChoice | null => {
			const selfMatches = !!match(c.name ?? "");
			if (c.type !== "Multi") {
				return selfMatches ? c : null;
			}

			const mc = c as any; // IMultiChoice
			const filteredChildren = (mc.choices ?? [])
				.map((child: IChoice) => walk(child))
				.filter(Boolean) as IChoice[];

			if (selfMatches || filteredChildren.length > 0) {
				// Clone Multi node expanded with only matching children to avoid mutating original
				return { ...mc, collapsed: false, choices: filteredChildren } as IChoice;
			}

			return null;
		};

		return list
			.map((c) => walk(c))
			.filter(Boolean) as IChoice[];
	}

	// Subscribe to settings changes to keep choices in sync
	onMount(() => {
		const unsubSettingsStore = settingsStore.subscribe((settings) => {
			choices = settings.choices;
		});

		return () => {
			unsubSettingsStore();
		};
	});

	// Command registry for managing Obsidian commands
	const commandRegistry = new CommandRegistry(plugin);

	function addChoiceToList(event: any): void {
		const { name, type } = event.detail;
		const newChoice = createChoice(type as ChoiceType, name);
		choices = [...choices, newChoice];
		saveChoices(choices);
	}

	async function deleteChoice(e: any) {
		const choice: IChoice = e.detail.choice;

		const userConfirmed = await deleteChoiceWithConfirmation(choice, app);
		if (!userConfirmed) return;

		// Remove choice from array (including nested choices)
		choices = choices.filter((value) =>
			removeChoiceHelper(choice.id, value),
		);
		commandRegistry.disableCommand(choice);
		saveChoices(choices);
	}

	function removeChoiceHelper(id: string, value: IChoice): boolean {
		if (value.type === "Multi") {
			(value as any).choices = (value as any).choices.filter((v: any) =>
				removeChoiceHelper(id, v),
			);
		}
		return value.id !== id;
	}

	async function handleConfigureChoice(e: any) {
		const { choice: oldChoice } = e.detail;

		const updatedChoice = await configureChoice(oldChoice, app, plugin);
		if (!updatedChoice) return;

		choices = choices.map((choice) =>
			updateChoiceHelper(choice, updatedChoice),
		);
		commandRegistry.updateCommand(oldChoice, updatedChoice);
		saveChoices(choices);
	}

	function updateChoiceHelper(
		oldChoice: IChoice,
		newChoice: IChoice,
	): IChoice {
		if (oldChoice.id === newChoice.id) {
			return { ...oldChoice, ...newChoice };
		}

		if (oldChoice.type === "Multi") {
			const multiChoice = oldChoice as any;
			const updatedChoices = multiChoice.choices.map((c: any) =>
				updateChoiceHelper(c, newChoice),
			);
			return { ...multiChoice, choices: updatedChoices };
		}

		return oldChoice;
	}

	async function toggleCommandForChoice(e: any) {
		const { choice: oldChoice } = e.detail;
		const updatedChoice = createToggleCommandChoice(oldChoice);

		choices = choices.map((choice) =>
			updateChoiceHelper(choice, updatedChoice),
		);
		updatedChoice.command
			? commandRegistry.enableCommand(updatedChoice)
			: commandRegistry.disableCommand(updatedChoice);
		saveChoices(choices);
	}

	async function handleDuplicateChoice(e: any) {
		const { choice: sourceChoice } = e.detail;
		const newChoice = duplicateChoice(sourceChoice);
		choices = [...choices, newChoice];
		saveChoices(choices);
	}

	function handleMoveChoice(e: any) {
		const { choice, targetId } = e.detail;
		choices = moveChoiceService(choices, choice.id, targetId);
		saveChoices(choices);
	}

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
	<div class="choiceFilterBar">
		<div class="choiceFilterInputWrapper">
			<input
				type="text"
				placeholder="Filter choices (fuzzy)"
				bind:value={filterQuery}
				autocapitalize="off"
				autocorrect="off"
				spellcheck={false}
				on:keydown={(e) => {
					if (e.key === 'Escape' && filterQuery) {
						filterQuery = "";
						e.stopPropagation();
					}
				}}
			/>
			{#if filterQuery}
				<button class="choiceFilterClear" aria-label="Clear filter" title="Clear"
					on:click={() => (filterQuery = "")}
				>
					<ObsidianIcon iconId="x" size={14} />
				</button>
			{/if}
		</div>
	</div>

	{#if filterQuery.trim().length === 0}
		<ChoiceList
			type="main"
			app={app}
			roots={choices}
			bind:choices
			on:deleteChoice={deleteChoice}
			on:configureChoice={handleConfigureChoice}
			on:toggleCommand={toggleCommandForChoice}
			on:duplicateChoice={handleDuplicateChoice}
			on:moveChoice={handleMoveChoice}
			on:reorderChoices={(e) => saveChoices(e.detail.choices)}
		/>
	{:else}
		<ChoiceList
			type="main"
			app={app}
			roots={choices}
			choices={filterChoices(choices, filterQuery)}
			forceDragDisabled={true}
			on:deleteChoice={deleteChoice}
			on:configureChoice={handleConfigureChoice}
			on:toggleCommand={toggleCommandForChoice}
			on:duplicateChoice={handleDuplicateChoice}
			on:moveChoice={handleMoveChoice}
		/>
	{/if}
	<div class="choiceViewBottomBar">
		{#if !settingsStore.getState().disableOnlineFeatures}
			<button class="mod-cta" on:click={openAISettings}
				>AI Assistant</button
			>
		{/if}
		<AddChoiceBox on:addChoice={addChoiceToList} />
	</div>
</div>

<style>
	.choiceViewBottomBar {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
		margin-top: 1rem;
		gap: 1rem;
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
		.choiceViewBottomBar {
			flex-direction: column;
		}
	}
</style>
