<script lang="ts">
import type { ICommand } from "../../types/macros/ICommand";
import { type DndEvent, SOURCES } from "svelte-dnd-action";
import { TemplateChoiceBuilder } from "../ChoiceBuilder/templateChoiceBuilder";
import { CaptureChoiceBuilder } from "../ChoiceBuilder/captureChoiceBuilder";
import type ICaptureChoice from "../../types/choices/ICaptureChoice";
import type ITemplateChoice from "../../types/choices/ITemplateChoice";
import type IChoice from "../../types/choices/IChoice";
import { App } from "obsidian";
import QuickAdd from "../../main";
import type { IUserScript } from "../../types/macros/IUserScript";
import { UserScriptSettingsModal } from "./UserScriptSettingsModal";
import { log } from "../../logger/logManager";
import { getUserScript } from "src/utilityObsidian";
import type { IAIAssistantCommand } from "src/types/macros/QuickCommands/IAIAssistantCommand";
import { AIAssistantCommandSettingsModal } from "./AIAssistantCommandSettingsModal";
import type { IOpenFileCommand } from "../../types/macros/QuickCommands/IOpenFileCommand";
import { OpenFileCommandSettingsModal } from "./OpenFileCommandSettingsModal";

export let commands: ICommand[];
export let deleteCommand: (commandId: string) => Promise<void>;
export let saveCommands: (commands: ICommand[]) => void;
export let app: App;
export let plugin: QuickAdd;
let _dragDisabled: boolean = true;

export const updateCommandList: (newCommands: ICommand[]) => void = (
	newCommands: ICommand[]
) => {
	commands = newCommands;
};

function _handleConsider(e: CustomEvent<DndEvent>) {
	const { items: newItems } = e.detail;
	commands = newItems as ICommand[];
}

function _handleSort(e: CustomEvent<DndEvent>) {
	const {
		items: newItems,
		info: { source },
	} = e.detail;

	commands = newItems as ICommand[];

	if (source === SOURCES.POINTER) {
		_dragDisabled = true;
	}

	saveCommands(commands);
}

const _startDrag = (e: CustomEvent<DndEvent>) => {
	e.preventDefault();
	_dragDisabled = false;
};

function _updateCommandFromEvent(e: CustomEvent) {
	const command: ICommand = e.detail;
	updateCommand(command);
}

function updateCommand(command: ICommand) {
	const index = commands.findIndex((c) => c.id === command.id);
	commands[index] = command;

	saveCommands(commands);
}

async function _configureChoice(e: CustomEvent) {
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
			return new TemplateChoiceBuilder(app, choice as ITemplateChoice, plugin);
		case "Capture":
			return new CaptureChoiceBuilder(app, choice as ICaptureChoice, plugin);
		default:
			break;
	}
}

async function _configureScript(e: CustomEvent) {
	const command: IUserScript = e.detail;

	const userScript = await getUserScript(command, app);
	if (!userScript?.settings) {
		log.logWarning(`${command.name} has no settings.`);
		return;
	}

	new UserScriptSettingsModal(app, command, userScript.settings).open();
}

async function _configureAssistant(e: CustomEvent) {
	const command: IAIAssistantCommand = e.detail;

	const newSetings = await new AIAssistantCommandSettingsModal(app, command)
		.waitForClose;

	if (newSetings) {
		updateCommand(command);
	}
}

async function _configureOpenFile(e: CustomEvent) {
	const command: IOpenFileCommand = e.detail;

	const updatedCommand = await new OpenFileCommandSettingsModal(app, command)
		.waitForClose;

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
