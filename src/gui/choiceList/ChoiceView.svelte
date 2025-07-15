<script lang="ts">
	import type IChoice from "../../types/choices/IChoice";
	import ChoiceList from "./ChoiceList.svelte";
	import AddChoiceBox from "./AddChoiceBox.svelte";
	import { App } from "obsidian";
	import QuickAdd from "../../main";
	import { settingsStore } from "src/settingsStore";
	import { AIAssistantSettingsModal } from "../AIAssistantSettingsModal";
	import { onMount } from "svelte";
	import { 
		createChoice, 
		deleteChoiceWithConfirmation, 
		configureChoice, 
		createToggleCommandChoice,
		CommandRegistry,
		type ChoiceType 
	} from "../../services/choiceService";

	export let choices: IChoice[] = [];
	export let saveChoices: (choices: IChoice[]) => void;
	export let app: App;
	export let plugin: QuickAdd;

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
		choices = choices.filter((value) => removeChoiceHelper(choice.id, value));
		commandRegistry.disableCommand(choice);
		saveChoices(choices);
	}

	function removeChoiceHelper(id: string, value: IChoice): boolean {
		if (value.type === "Multi") {
			(value as any).choices = (value as any).choices.filter((v: any) => 
				removeChoiceHelper(id, v)
			);
		}
		return value.id !== id;
	}

	async function handleConfigureChoice(e: any) {
		const { choice: oldChoice } = e.detail;

		const updatedChoice = await configureChoice(oldChoice, app, plugin);
		if (!updatedChoice) return;

		choices = choices.map((choice) => updateChoiceHelper(choice, updatedChoice));
		commandRegistry.updateCommand(oldChoice, updatedChoice);
		saveChoices(choices);
	}

	function updateChoiceHelper(oldChoice: IChoice, newChoice: IChoice): IChoice {
		if (oldChoice.id === newChoice.id) {
			return { ...oldChoice, ...newChoice };
		}

		if (oldChoice.type === "Multi") {
			const multiChoice = oldChoice as any;
			const updatedChoices = multiChoice.choices.map((c: any) =>
				updateChoiceHelper(c, newChoice)
			);
			return { ...multiChoice, choices: updatedChoices };
		}

		return oldChoice;
	}

	async function toggleCommandForChoice(e: any) {
		const { choice: oldChoice } = e.detail;
		const updatedChoice = createToggleCommandChoice(oldChoice);

		choices = choices.map((choice) => updateChoiceHelper(choice, updatedChoice));
		updatedChoice.command
			? commandRegistry.enableCommand(updatedChoice)
			: commandRegistry.disableCommand(updatedChoice);
		saveChoices(choices);
	}

	async function handleDuplicateChoice(e: any) {
		const { choice: sourceChoice } = e.detail;
		const { duplicateChoice } = await import("../../utils/choiceDuplicator");
		const newChoice = duplicateChoice(sourceChoice);
		choices = [...choices, newChoice];
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
	<ChoiceList
		type="main"
		bind:choices
		on:deleteChoice={deleteChoice}
		on:configureChoice={handleConfigureChoice}
		on:toggleCommand={toggleCommandForChoice}
		on:duplicateChoice={handleDuplicateChoice}
		on:reorderChoices={(e) => saveChoices(e.detail.choices)}
	/>
	<div class="choiceViewBottomBar">
		<div style="display: flex; gap: 4px;">
			{#if !settingsStore.getState().disableOnlineFeatures}
				<button class="mod-cta" on:click={openAISettings}
					>AI Assistant</button
				>
			{/if}
		</div>
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

	@media (max-width: 800px) {
		.choiceViewBottomBar {
			flex-direction: column;
		}
	}
</style>
