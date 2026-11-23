<script lang="ts">
import type { ICommand } from "../../types/macros/ICommand";
import { type DndEvent, dndzone, SOURCES, TRIGGERS } from "svelte-dnd-action";
import { baseDndOptions, createDropRecovery, keyedItems, replaceById, showDragPillOnStart, stripShadow } from "../shared/dndReorder";
import { moveByKeyboard } from "../shared/keyboardReorder";
import { createDragArming } from "../shared/dragArming.svelte";
import { getCommandDisplayName } from "../../utils/macroHelpers";
import { snapshot } from "../svelte/persist.svelte";
import type { CommandListProps } from "./commandListProps";
import CommandRow from "./Components/CommandRow.svelte";
import { CommandType } from "../../types/macros/CommandType";
import WaitCommand from "./Components/WaitCommand.svelte";
import { TemplateChoiceBuilder } from "../ChoiceBuilder/templateChoiceBuilder";
import { CaptureChoiceBuilder } from "../ChoiceBuilder/captureChoiceBuilder";
import type ICaptureChoice from "../../types/choices/ICaptureChoice";
import type ITemplateChoice from "../../types/choices/ITemplateChoice";
import type IChoice from "../../types/choices/IChoice";
import type { IUserScript } from "../../types/macros/IUserScript";
import { UserScriptSettingsModal } from "./UserScriptSettingsModal";
import { log } from "../../logger/logManager";
import { isUserScriptLoadError, loadUserScript } from "src/utils/userScript";
import type { IAIAssistantCommand } from "src/types/macros/QuickCommands/IAIAssistantCommand";
import { AIAssistantCommandSettingsModal } from "./AIAssistantCommandSettingsModal";
import type { IOpenFileCommand } from "../../types/macros/QuickCommands/IOpenFileCommand";
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

// Everything rendered, handed to the dnd zone, or reordered (see keyedItems).
// CommandSequenceEditor normalizes the list first, so this only drops holes.
const renderable = $derived(keyedItems<ICommand>(commands));

// A drop-zone type unique to this list: svelte-dnd-action hit-tests every zone of
// a type geometrically, through modal backdrops, so the branch editor would drop
// into the builder underneath. Not `dropFromOthersDisabled`: its refuse path
// re-dispatches the items with and without the placeholder, which stripShadow
// breaks.
const zoneId = $props.id();
const zoneType = `command:${zoneId}`;

// Desktop: drag is armed by grabbing the handle (see createDragArming). Mobile: the
// whole row drags by long-press.
const drag = createDragArming();
const dragDisabled = $derived(drag.disabled);

let listEl: HTMLOListElement | undefined = $state();

// Narrowing helpers: the {#each} discriminates on command.type, so each child
// receives the matching subtype. Passed one-way: children report edits via the
// onUpdateCommand / onConfigure* callbacks, not via two-way binding.
const asWait = (c: ICommand) => c as IWaitCommand;
const asConditional = (c: ICommand) => c as IConditionalCommand;

// The settings button of a step whose type has something to configure.
function configureHandler(command: ICommand): (() => void) | undefined {
	switch (command.type) {
		case CommandType.NestedChoice:
			return () => configureChoice(command as INestedChoiceCommand);
		case CommandType.UserScript:
			return () => void configureScript(command as IUserScript);
		case CommandType.AIAssistant:
			return () => void configureAssistant(command as IAIAssistantCommand);
		case CommandType.OpenFile:
			return () => void configureOpenFile(command as IOpenFileCommand);
		default:
			return undefined;
	}
}

/** Persist the current order/content to the host (plain, non-proxy snapshot). */
function persist() {
	saveCommands(snapshot(commands));
}

// Recovers the dragged command when a drop lands in the placeholder window
// (mobile long-press with little or no movement).
const dropRecovery = createDropRecovery<ICommand>();

// A drag is underway: from its first consider until finalize (pointer) or a
// DRAG_STOPPED consider (keyboard). Dragging the only command empties
// `commands` (stripShadow), and the zone must stay in place for the drop.
let dragging = $state(false);

function handleConsider(e: CustomEvent<DndEvent>) {
	drag.markStarted(); // a genuine drag is underway (see the arming failsafe)
	dragging = e.detail.info.trigger !== TRIGGERS.DRAG_STOPPED;
	const event = e as CustomEvent<DndEvent<ICommand>>;
	showDragPillOnStart(event, getCommandDisplayName);
	// Strip the shadow placeholder so a command cannot linger in state and leave
	// a ghost gap.
	commands = dropRecovery.consider(event);
}

function handleSort(e: CustomEvent<DndEvent>) {
	dragging = false;
	commands = dropRecovery.finalize(e as CustomEvent<DndEvent<ICommand>>);

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
let startDrag = (event: PointerEvent) => {
	drag.startDrag(event);
};

// Keyboard reorder: persists via the same snapshot path as a pointer drag's finalize.
// `renderable`, not `commands`: stripShadow reads `item.id`, so the raw list would
// throw on the very hole the render filter exists to hide.
function moveCommand(id: string, delta: -1 | 1) {
	moveByKeyboard({
		listEl,
		items: stripShadow(renderable),
		id,
		delta,
		describe: getCommandDisplayName,
		commit: (next) => {
			commands = next;
			persist();
		},
	});
}

function updateCommand(command: ICommand) {
	// `renderable` for the same reason as moveCommand: replaceById maps over
	// `item.id`. A copy, so the row re-renders after an edit made in place on a
	// step added this session: a class instance, which $state does not proxy.
	commands = replaceById(renderable, { ...command });
	persist();
}

// The conditional handlers open a modal or page that MUTATES the passed command
// (its condition / then- / else-commands). Because `command` is a $state proxy,
// that mutation does NOT write through to the host's commandsRef - so we must
// persist it here via the same snapshot path as every other edit
// (updateCommand -> saveCommands).
async function configureConditionalCommand(command: IConditionalCommand) {
	if (await onConfigureCondition?.(command)) updateCommand(command);
}

function editConditionalThen(command: IConditionalCommand) {
	onEditThenBranch?.(command, () => updateCommand(command));
}

function editConditionalElse(command: IConditionalCommand) {
	onEditElseBranch?.(command, () => updateCommand(command));
}

// The step's choice, as a page over the macro. Saved into the list when the page
// is left, synchronously, so it is in before the macro page saves (BuilderPage).
function configureChoice(command: INestedChoiceCommand) {
	const onSave = (newChoice: IChoice) => {
		// Immutable update (avoids mutating host-owned $state from this component).
		const updated: INestedChoiceCommand = { ...command, choice: newChoice, name: newChoice.name };
		updateCommand(updated);
	};
	const choice = command.choice;
	if (choice.type === "Template") {
		new TemplateChoiceBuilder(app, choice as ITemplateChoice, plugin, onSave).open();
	} else if (choice.type === "Capture") {
		new CaptureChoiceBuilder(app, choice as ICaptureChoice, plugin, onSave).open();
	}
}

async function configureScript(command: IUserScript) {
	let loaded: Awaited<ReturnType<typeof loadUserScript>>;
	try {
		loaded = await loadUserScript(command, app);
	} catch (error) {
		// Already reported, e.g. "could not find" for a moved script.
		if (isUserScriptLoadError(error)) return;
		throw error;
	}
	if (!loaded?.script) {
		log.logWarning(`${command.name} could not be loaded.`);
		return;
	}

	// The settings definition lives on the module; `Script::Export` drills
	// to the export that runs, which usually has no `settings` of its own.
	const scriptSettings = loaded.settings ?? {};

	new UserScriptSettingsModal(
		app,
		plugin,
		command,
		scriptSettings as ConstructorParameters<typeof UserScriptSettingsModal>[3],
		() => persist(),
	).open();
}

async function configureAssistant(command: IAIAssistantCommand) {
	const newSettings = await new AIAssistantCommandSettingsModal(app, command)
		.waitForClose;

	if (newSettings) {
		updateCommand(newSettings);
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
	bind:this={listEl}
	class="quickAddCommandList"
	class:is-empty={renderable.length === 0 && !dragging}
	use:dndzone={baseDndOptions({
		items: renderable,
		dragDisabled,
		type: zoneType,
		// A command's `.name` differs from its rendered label for Choice/Conditional
		// commands (getCommandDisplayName resolves the referenced choice's name / the
		// "If …" summary), so the pill must resolve the label the same way the row does.
		resolveLabel: getCommandDisplayName,
	})}
	onconsider={handleConsider}
	onfinalize={handleSort}
>
	{#each stripShadow(renderable) as command (command.id)}
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
			<CommandRow
				{command}
				{dragDisabled}
				{startDrag}
				onDeleteCommand={deleteCommand}
				onConfigure={configureHandler(command)}
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

	/* A macro without steps shows no blank list area. The zone type is unique
	   to this list, so an empty list is never a drop target. */
	.quickAddCommandList.is-empty {
		display: none;
	}
</style>
