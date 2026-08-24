<script lang="ts">
import type { ICommand } from "../../types/macros/ICommand";
import { Platform } from "obsidian";
import { alertToScreenReader, type DndEvent, dndzone, SOURCES } from "svelte-dnd-action";
import { baseDndOptions, capturePlaceholderRecovery, type PlaceholderRecovery, replaceById, stripShadow } from "../shared/dndReorder";
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

// Everything rendered, handed to the dnd zone, or reordered is filtered to
// entries that can actually be keyed: an object with a unique, non-empty string
// id. svelte-dnd-action reads `.id` on every item and the keyed {#each} throws
// `each_key_duplicate` on a repeat (#1451, #1593) — and on a POST-mount update
// that throw escapes mountComponent's try entirely (see its doc comment), so
// this has to be a $derived, not a one-off check at setup.
//
// CommandSequenceEditor normalizes the list before it ever gets here, so in
// practice this filter is a no-op: an id-less or duplicate-id command has
// already been given a fresh uuid and KEPT. That matters, because the persist
// path below writes back the list this zone was seeded with — a filter that
// silently dropped a real command would delete it from data.json on the first
// reorder. The only thing it can still drop is a `null`/primitive hole, which
// carries nothing.
const renderable = $derived.by(() => {
	const seen = new Set<string>();
	if (!Array.isArray(commands)) return [];
	return commands.filter((command) => {
		if (typeof command !== "object" || command === null) return false;
		const id = command.id;
		if (typeof id !== "string" || id === "" || seen.has(id)) return false;
		seen.add(id);
		return true;
	});
});

// A drop-zone type unique to THIS list, so no two command lists are ever drop
// targets for each other (#1613).
//
// They used to share `type: "command"`. The conditional-branch editor opens ON
// TOP of the still-open macro builder, and svelte-dnd-action hit-tests every
// registered zone of a type GEOMETRICALLY — a modal backdrop shields nothing — so
// dragging a command a little too far down inside the branch editor dropped it
// into the builder underneath, and both editors then rendered a list that
// disagreed with the stored macro.
//
// The id comes from Svelte's own `$props.id()` (a runtime-wide uid counter,
// already used by LabeledField), so no bespoke counter is needed.
//
// A unique type rather than `dropFromOthersDisabled`, which was tried first and
// is worse: the target does refuse, but the library then runs its
// "left for a zone that refuses" path, which re-dispatches the origin's items
// twice — once with its shadow placeholder and once without — and our
// stripShadow (#1244/#883) drops the placeholder the library goes on to measure,
// so the drag ends in an uncaught TypeError with the command gone from the
// source list. With a unique type the other zone is not a candidate at all, so
// leaving this one is an ordinary "outside of any zone" drag: the command
// springs back, which is the correct behaviour for a gesture QuickAdd does not
// offer.
const zoneId = $props.id();
const zoneType = `command:${zoneId}`;

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

// The dragged command, reconstructed from the last placeholder-id shadow that
// stripShadow discarded (see capturePlaceholderRecovery). A drop inside that
// window (mobile long-press with little or no movement) would otherwise commit
// the list without the dragged command (#1692, same window as ChoiceList's).
// handleSort re-inserts the payload then, at the index the placeholder last
// occupied — the first DRAGGED_ENTERED can already carry the user's intended
// position, and a pre-drag-order restore would silently cancel it.
let placeholderRecovery: PlaceholderRecovery<ICommand> | null = null;

function handleConsider(e: CustomEvent<DndEvent>) {
	drag.markStarted(); // a genuine drag is underway (see the arming failsafe)
	const items = e.detail.items as ICommand[];
	placeholderRecovery =
		capturePlaceholderRecovery(items, e.detail.info.id) ?? placeholderRecovery;
	// Strip svelte-dnd-action's shadow placeholder so a command can't linger in
	// state and vanish on reorder (ghost gap) — see [[svelte-dnd-action-shadow-placeholder]].
	commands = stripShadow(items);
}

function handleSort(e: CustomEvent<DndEvent>) {
	let next = stripShadow(e.detail.items as ICommand[]);
	const draggedId = e.detail.info.id;
	if (placeholderRecovery?.item.id === draggedId && !next.some((c) => c.id === draggedId)) {
		// Dropped inside the placeholder window (see placeholderRecovery):
		// committing `next` would delete the dragged command. Re-insert it
		// where the stripped placeholder last stood.
		next = [...next];
		next.splice(Math.min(placeholderRecovery.index, next.length), 0, placeholderRecovery.item);
	}
	placeholderRecovery = null;
	commands = next;

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
	// `renderable`, not `commands`: stripShadow reads `item.id`, so the raw list
	// would throw on the very hole the render filter exists to hide.
	const list = stripShadow(renderable);
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
	// `renderable` for the same reason as moveCommand: replaceById maps over
	// `item.id`.
	commands = replaceById(renderable, command);
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
