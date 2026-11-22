<script lang="ts">
	import type IChoice from "../../types/choices/IChoice";
	import RightButtons from "./ChoiceItemRightButtons.svelte";
	import { Platform, type App } from "obsidian";
	import { choiceRowMenu } from "./contextMenu";
	import { choiceName } from "./renderChoiceName";
	import type { ChoiceListActions } from "./choiceListActions";
	import { resolveChoiceIcon } from "../../utils/choiceUtils";
	import ObsidianIcon from "../components/ObsidianIcon.svelte";

	let {
		choice,
		app,
		roots,
		dragDisabled,
		startDrag,
		actions,
		onMoveUp,
		onMoveDown,
	}: {
		choice: IChoice;
		app: App;
		roots: IChoice[];
		dragDisabled: boolean;
		startDrag: (e?: Event) => void;
		actions: ChoiceListActions;
		onMoveUp?: () => void;
		onMoveDown?: () => void;
	} = $props();

	const menu = choiceRowMenu(() => ({ choice, roots, actions }));
</script>

<!-- Right-click opens the context menu for mouse users; double-click is a mouse
     shortcut for Configure — keyboard users reach both via the (focusable)
     "Configure" and "More options" buttons, so this row stays a non-interactive
     container (no role/tabindex). -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="choiceListItem"
	data-choice-id={choice.id}
	oncontextmenu={menu.onContextMenu}
	ondblclick={(evt) => {
		// Desktop-only mouse shortcut: on mobile the bare row surface belongs to
		// long-press drag, and svelte-dnd-action's touch false-alarm replays a
		// synthetic click (see stopDragInit) that must not reach row actions.
		if (Platform.isMobile) return;
		// Only bare-row double-clicks configure; a double-click on a button or a
		// rendered markdown link inside the name keeps its own meaning.
		const target = evt.target as HTMLElement;
		if (target.closest("button, a")) return;
		actions.onConfigureChoice(choice);
	}}
>
	<span class="qaChoiceRowIcon" aria-hidden="true">
		<ObsidianIcon iconId={resolveChoiceIcon(choice)} size={15} />
	</span>
	<span class="choiceListItemName" use:choiceName={{ name: choice.name, app }}></span>

	<RightButtons
		onDragHandleDown={startDrag}
		onDeleteChoice={() => actions.onDeleteChoice(choice)}
		onConfigureChoice={() => actions.onConfigureChoice(choice)}
		onToggleCommand={() => actions.onToggleCommand(choice)}
		onDuplicateChoice={() => actions.onDuplicateChoice(choice)}
		onOpenMenu={menu.openAt}
		{onMoveUp}
		{onMoveDown}
		choiceName={choice.name}
		commandEnabled={choice.command}
		{dragDisabled}
		showDuplicateButton={true}
	/>
</div>
