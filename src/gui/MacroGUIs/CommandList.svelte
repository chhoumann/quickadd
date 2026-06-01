<script lang="ts">
import type { ICommand } from "../../types/macros/ICommand";
import { Platform } from "obsidian";
import { alertToScreenReader, type DndEvent, dndzone, SOURCES } from "svelte-dnd-action";
import { baseDndOptions, replaceById, stripShadow } from "../shared/dndReorder";
import { createDragArming } from "../shared/dragArming.svelte";
import { getCommandDisplayName } from "../../utils/macroHelpers";
import { snapshot } from "../svelte/persist.svelte";
import type { CommandListProps } from "./commandListProps.svelte";
import StandardCommand from "./Components/StandardCommand.svelte";
import { CommandType } from "../../types/macros/CommandType";
import WaitCommand from "./Components/WaitCommand.svelte";
import NestedChoiceCommand from "./Components/NestedChoiceCommand.svelte";
import { TemplateChoiceBuilder } from "../ChoiceBuilder/templateChoiceBuilder";
import { CaptureChoiceBuilder } from "../ChoiceBuilder/captureChoiceBuilder";
import type ICaptureChoice from "../../types/choices/ICaptureChoice";
import type ITemplateChoice from "../../types/choices/ITemplateChoice";
import type IChoice from "../../types/choices/IChoice";
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
import ConditionalCommand from "./Components/ConditionalCommand.svelte";
import type { IWaitCommand } from "../../types/macros/QuickCommands/IWaitCommand";
import type { INestedChoiceCommand } from "../../types/macros/QuickCommands/INestedChoiceCommand";
import type { IConditionalCommand } from "../../types/macros/Conditional/IConditionalCommand";

let {
	commands = $bindable([]),
	app,
	plugin,
	deleteCommand,
	saveCommands,
	onConfigureCondition,
	onEditThenBranch,
	onEditElseBranch,
}: CommandListProps = $props();

const isMobile = Platform.isMobile;
// Desktop: drag is armed by grabbing the handle (shared with the choices list; see
// createDragArming for the click-swallow failsafe). Mobile: no handle — the whole row
// is draggable by long-press (delayTouchStart), so drag stays enabled.
const drag = createDragArming();
const dragDisabled = $derived(!isMobile && !drag.armed);

// Narrowing helpers: the {#each} discriminates on command.type, so each child
// receives the matching subtype. Passed one-way — children report edits via the
// onUpdateCommand / onConfigure* callbacks, not via two-way binding.
const asWait = (c: ICommand) => c as IWaitCommand;
const asNested = (c: ICommand) => c as INestedChoiceCommand;
const asUserScript = (c: ICommand) => c as IUserScript;
const asAI = (c: ICommand) => c as IAIAssistantCommand;
const asOpenFile = (c: ICommand) => c as IOpenFileCommand;
const asConditional = (c: ICommand) => c as IConditionalCommand;

/** Persist the current order/content to the host (plain, non-proxy snapshot). */
function persist() {
	saveCommands(snapshot(commands));
}

function handleConsider(e: CustomEvent<DndEvent>) {
	drag.markStarted(); // a genuine drag is underway (see the arming failsafe)
	// Strip svelte-dnd-action's shadow placeholder so a command can't linger in
	// state and vanish on reorder (ghost gap) — see [[svelte-dnd-action-shadow-placeholder]].
	commands = stripShadow(e.detail.items as ICommand[]);
}

function handleSort(e: CustomEvent<DndEvent>) {
	commands = stripShadow(e.detail.items as ICommand[]);

	// Desktop: disarm after a pointer drag so the handle must be grabbed again.
	// Mobile: dragDisabled ignores `armed`, so this is a no-op.
	if (e.detail.info.source === SOURCES.POINTER) {
		drag.reset();
	}

	persist();
}

// Arm svelte-dnd-action's pointer drag (desktop handle). NO preventDefault here —
// see DragHandle: preventDefault on pointerdown would suppress the compat mousedown
// the library starts the drag from.
let startDrag = () => {
	drag.startDrag();
};

// Keyboard reorder (ArrowUp/ArrowDown on a row's drag handle): move the command one
// step and persist via the same snapshot path as a pointer drag's finalize.
function moveCommand(id: string, direction: -1 | 1) {
	const list = stripShadow(commands);
	const index = list.findIndex((c) => c.id === id);
	if (index === -1) return;
	const target = index + direction;
	if (target < 0 || target >= list.length) return; // clamp at the ends
	const next = [...list];
	const [moved] = next.splice(index, 1);
	next.splice(target, 0, moved);
	commands = next;
	persist();
	// autoAriaDisabled silences the library's own move alerts, so announce the
	// keyboard reorder ourselves.
	alertToScreenReader(
		`Moved ${getCommandDisplayName(moved)} to position ${target + 1} of ${list.length}`,
	);
}

function updateCommand(command: ICommand) {
	commands = replaceById(commands, command);
	persist();
}

// The conditional handlers open a modal that MUTATES the passed command (its
// condition / then- / else-commands). Because `command` is a $state proxy, that
// mutation does NOT write through to the host's commandsRef — so we must persist it
// here via the same snapshot path as every other edit (updateCommand -> saveCommands).
async function configureConditionalCommand(command: IConditionalCommand) {
	if (await onConfigureCondition?.(command)) updateCommand(command);
}

async function editConditionalThen(command: IConditionalCommand) {
	if (await onEditThenBranch?.(command)) updateCommand(command);
}

async function editConditionalElse(command: IConditionalCommand) {
	if (await onEditElseBranch?.(command)) updateCommand(command);
}

async function configureChoice(command: INestedChoiceCommand) {
	const newChoice = await getChoiceBuilder(command.choice)?.waitForClose;
	if (!newChoice) return;

	// Immutable update (avoids mutating host-owned $state from this component).
	const updated: INestedChoiceCommand = {
		...command,
		choice: newChoice,
		name: newChoice.name,
	};
	updateCommand(updated);
}

function getChoiceBuilder(choice: IChoice) {
	switch (choice.type) {
		case "Template":
			return new TemplateChoiceBuilder(app, choice as ITemplateChoice, plugin);
		case "Capture":
			return new CaptureChoiceBuilder(app, choice as ICaptureChoice, plugin);
		case "Macro":
		case "Multi":
		default:
			break;
	}
}

async function configureScript(command: IUserScript) {
	const userScript = await getUserScript(command, app);
	if (!userScript) {
		log.logWarning(`${command.name} could not be loaded.`);
		return;
	}

	const scriptSettings =
		(userScript as { settings?: { [key: string]: unknown } }).settings ?? {};

	new UserScriptSettingsModal(
		app,
		command,
		scriptSettings as ConstructorParameters<typeof UserScriptSettingsModal>[2],
		() => persist(),
	).open();
}

async function configureAssistant(command: IAIAssistantCommand) {
	const newSettings = await new AIAssistantCommandSettingsModal(app, command)
		.waitForClose;

	if (newSettings) {
		updateCommand(command);
	}
}

async function configureOpenFile(command: IOpenFileCommand) {
	const updatedCommand = await new OpenFileCommandSettingsModal(app, command)
		.waitForClose;

	if (updatedCommand) {
		updateCommand(updatedCommand);
	}
}
</script>

<ol
	class="quickAddCommandList"
	use:dndzone={baseDndOptions({
		items: commands,
		dragDisabled,
		type: "command",
		// A command's `.name` differs from its rendered label for Choice/Conditional
		// commands (getCommandDisplayName resolves the referenced choice's name / the
		// "If …" summary), so the pill must resolve the label the same way the row does.
		resolveLabel: getCommandDisplayName,
	})}
	onconsider={handleConsider}
	onfinalize={handleSort}
>
	{#each stripShadow(commands) as command (command.id)}
		{#if command.type === CommandType.Wait}
			<WaitCommand
				command={asWait(command)}
				{dragDisabled}
				{startDrag}
				onDeleteCommand={deleteCommand}
				onUpdateCommand={updateCommand}
				onMoveUp={() => moveCommand(command.id, -1)}
				onMoveDown={() => moveCommand(command.id, 1)}
			/>
		{:else if command.type === CommandType.NestedChoice}
			<NestedChoiceCommand
				command={asNested(command)}
				{dragDisabled}
				{startDrag}
				onDeleteCommand={deleteCommand}
				onConfigureChoice={configureChoice}
				onMoveUp={() => moveCommand(command.id, -1)}
				onMoveDown={() => moveCommand(command.id, 1)}
			/>
		{:else if command.type === CommandType.UserScript}
			<UserScriptCommand
				command={asUserScript(command)}
				{dragDisabled}
				{startDrag}
				onDeleteCommand={deleteCommand}
				onConfigureScript={configureScript}
				onMoveUp={() => moveCommand(command.id, -1)}
				onMoveDown={() => moveCommand(command.id, 1)}
			/>
		{:else if command.type === CommandType.AIAssistant}
			<AIAssistantCommand
				command={asAI(command)}
				{dragDisabled}
				{startDrag}
				onDeleteCommand={deleteCommand}
				onConfigureAssistant={configureAssistant}
				onMoveUp={() => moveCommand(command.id, -1)}
				onMoveDown={() => moveCommand(command.id, 1)}
			/>
		{:else if command.type === CommandType.OpenFile}
			<OpenFileCommand
				command={asOpenFile(command)}
				{dragDisabled}
				{startDrag}
				onDeleteCommand={deleteCommand}
				onConfigureOpenFile={configureOpenFile}
				onMoveUp={() => moveCommand(command.id, -1)}
				onMoveDown={() => moveCommand(command.id, 1)}
			/>
		{:else if command.type === CommandType.Conditional}
			<ConditionalCommand
				command={asConditional(command)}
				{dragDisabled}
				{startDrag}
				onDeleteCommand={deleteCommand}
				onConfigureCondition={configureConditionalCommand}
				onEditThenBranch={editConditionalThen}
				onEditElseBranch={editConditionalElse}
				onMoveUp={() => moveCommand(command.id, -1)}
				onMoveDown={() => moveCommand(command.id, 1)}
			/>
		{:else}
			<StandardCommand
				{command}
				{dragDisabled}
				{startDrag}
				onDeleteCommand={deleteCommand}
				onMoveUp={() => moveCommand(command.id, -1)}
				onMoveDown={() => moveCommand(command.id, 1)}
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
