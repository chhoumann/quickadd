<script lang="ts">
	import type { ICommand } from "../../types/macros/ICommand";
	import {
		type DndEvent,
		dndzone,
		SOURCES,
		SHADOW_PLACEHOLDER_ITEM_ID,
	} from "svelte-dnd-action";
	import StandardCommand from "./Components/StandardCommand.svelte";
	import { CommandType } from "../../types/macros/CommandType";
	import WaitCommand from "./Components/WaitCommand.svelte";
	import NestedChoiceCommand from "./Components/NestedChoiceCommand.svelte";
	import { TemplateChoiceBuilder } from "../ChoiceBuilder/templateChoiceBuilder";
	import { CaptureChoiceBuilder } from "../ChoiceBuilder/captureChoiceBuilder";
	import type ICaptureChoice from "../../types/choices/ICaptureChoice";
	import type ITemplateChoice from "../../types/choices/ITemplateChoice";
	import type IChoice from "../../types/choices/IChoice";
	import { App } from "obsidian";
	import QuickAdd from "../../main";
	import UserScriptCommand from "./Components/UserScriptCommand.svelte";
	import type { IUserScript } from "../../types/macros/IUserScript";
	import { UserScriptSettingsModal } from "./UserScriptSettingsModal";
	import { log } from "../../logger/logManager";
	import { getUserScript } from "src/utilityObsidian";
	import type { IAIAssistantCommand } from "src/types/macros/QuickCommands/IAIAssistantCommand";
	import AIAssistantCommand from "./Components/AIAssistantCommand.svelte";
	import { AIAssistantCommandSettingsModal } from "./AIAssistantCommandSettingsModal";
	import type { IOpenFileCommand } from "../../types/macros/QuickCommands/IOpenFileCommand";
	import OpenFileCommand from "./Components/OpenFileCommand.svelte";
	import { OpenFileCommandSettingsModal } from "./OpenFileCommandSettingsModal";

	export let commands: ICommand[];
	export let deleteCommand: (commandId: string) => Promise<void>;
	export let saveCommands: (commands: ICommand[]) => void;
	export let app: App;
	export let plugin: QuickAdd;
	let dragDisabled: boolean = true;

	export const updateCommandList: (newCommands: ICommand[]) => void = (
		newCommands: ICommand[]
	) => {
		commands = newCommands;
	};

	function handleConsider(e: CustomEvent<DndEvent>) {
		let { items: newItems } = e.detail;
		commands = newItems as ICommand[];
	}

	function handleSort(e: CustomEvent<DndEvent>) {
		let {
			items: newItems,
			info: { source },
		} = e.detail;

		commands = newItems as ICommand[];

		if (source === SOURCES.POINTER) {
			dragDisabled = true;
		}

		saveCommands(commands);
	}

	let startDrag = (e: CustomEvent<DndEvent>) => {
		e.preventDefault();
		dragDisabled = false;
	};

	function updateCommandFromEvent(e: CustomEvent) {
		const command: ICommand = e.detail;
		updateCommand(command);
	}

	function updateCommand(command: ICommand) {
		const index = commands.findIndex((c) => c.id === command.id);
		commands[index] = command;

		saveCommands(commands);
	}

	async function configureChoice(e: CustomEvent) {
		const command = e.detail;
		const newChoice = await getChoiceBuilder(command.choice)?.waitForClose;
		if (!newChoice) return;

		command.choice = newChoice;
		command.name = newChoice.name;
		updateCommand(command);
	}

	function getChoiceBuilder(choice: IChoice) {
		switch (choice.type) {
			case "Template":
				return new TemplateChoiceBuilder(
					app,
					choice as ITemplateChoice,
					plugin
				);
			case "Capture":
				return new CaptureChoiceBuilder(
					app,
					choice as ICaptureChoice,
					plugin
				);
			case "Macro":
			case "Multi":
			default:
				break;
		}
	}

	async function configureScript(e: CustomEvent) {
		const command: IUserScript = e.detail;

		const userScript = await getUserScript(command, app);
		if (!userScript?.settings) {
			log.logWarning(`${command.name} has no settings.`);
			return;
		}

		new UserScriptSettingsModal(app, command, userScript.settings).open();
	}

	async function configureAssistant(e: CustomEvent) {
		const command: IAIAssistantCommand = e.detail;

		const newSetings = await new AIAssistantCommandSettingsModal(
			app,
			command
		).waitForClose;

        if (newSetings) {
            updateCommand(command);
        }
	}

	async function configureOpenFile(e: CustomEvent) {
		const command: IOpenFileCommand = e.detail;

		const updatedCommand = await new OpenFileCommandSettingsModal(
			app,
			command
		).waitForClose;

		if (updatedCommand) {
			updateCommand(updatedCommand);
		}
	}
</script>

<ol
	class="quickAddCommandList"
	use:dndzone={{
		items: commands,
		dragDisabled,
		dropTargetStyle: {},
		type: "command",
	}}
	on:consider={handleConsider}
	on:finalize={handleSort}
>
	{#each commands.filter((c) => c.id !== SHADOW_PLACEHOLDER_ITEM_ID) as command (command.id)}
		{#if command.type === CommandType.Wait}
			<WaitCommand
				bind:command
				bind:dragDisabled
				bind:startDrag
				on:deleteCommand={async (e) => await deleteCommand(e.detail)}
				on:updateCommand={updateCommandFromEvent}
			/>
		{:else if command.type === CommandType.NestedChoice}
			<NestedChoiceCommand
				bind:command
				bind:dragDisabled
				bind:startDrag
				on:deleteCommand={async (e) => await deleteCommand(e.detail)}
				on:updateCommand={updateCommandFromEvent}
				on:configureChoice={configureChoice}
			/>
		{:else if command.type === CommandType.UserScript}
			<UserScriptCommand
				bind:command
				bind:dragDisabled
				bind:startDrag
				on:deleteCommand={async (e) => await deleteCommand(e.detail)}
				on:updateCommand={updateCommandFromEvent}
				on:configureScript={configureScript}
			/>
		{:else if command.type === CommandType.AIAssistant}
			<AIAssistantCommand
				bind:command
				bind:dragDisabled
				bind:startDrag
				on:deleteCommand={async (e) => await deleteCommand(e.detail)}
				on:updateCommand={updateCommandFromEvent}
				on:configureAssistant={configureAssistant}
			/>
		{:else if command.type === CommandType.OpenFile}
			<OpenFileCommand
				bind:command
				bind:dragDisabled
				bind:startDrag
				on:deleteCommand={async (e) => await deleteCommand(e.detail)}
				on:updateCommand={updateCommandFromEvent}
				on:configureOpenFile={configureOpenFile}
			/>
		{:else}
			<StandardCommand
				bind:command
				bind:dragDisabled
				bind:startDrag
				on:deleteCommand={async (e) => await deleteCommand(e.detail)}
				on:updateCommand={updateCommandFromEvent}
			/>
		{/if}
	{/each}
</ol>

<style>
	.quickAddCommandList {
		display: grid;
		grid-template-columns: auto;
		width: auto;
		border: 0 solid black;
		overflow-y: auto;
		height: auto;
		margin-bottom: 8px;
		padding: 20px;
	}
</style>
