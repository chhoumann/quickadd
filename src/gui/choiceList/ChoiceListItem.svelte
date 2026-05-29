<script lang="ts">
	import type IChoice from "../../types/choices/IChoice";
	import RightButtons from "./ChoiceItemRightButtons.svelte";
	import { Component, type App } from "obsidian";
	import { showChoiceContextMenu } from "./contextMenu";
	import { renderChoiceName } from "./renderChoiceName";
	import type { ChoiceListActions } from "./choiceListActions";

	let {
		choice,
		app,
		roots,
		dragDisabled,
		startDrag,
		actions,
	}: {
		choice: IChoice;
		app: App;
		roots: IChoice[];
		dragDisabled: boolean;
		startDrag: (e?: Event) => void;
		actions: ChoiceListActions;
	} = $props();

	let showConfigureButton = $state(true);
	let nameElement = $state<HTMLSpanElement>();
	const cmp = new Component();

	// renderChoiceName writes to the DOM (it's a side effect) -> $effect, not $derived.
	$effect(() => {
		if (nameElement) {
			renderChoiceName(choice.name, nameElement, cmp, app);
		}
	});

	// renderChoiceName passes cmp to MarkdownRenderer.render as the lifecycle owner;
	// unload it on destroy so any registered child components are disposed (no deps
	// here, so the teardown runs only when this row is destroyed).
	$effect(() => {
		return () => cmp.unload();
	});

	function onContextMenu(evt: MouseEvent) {
		showChoiceContextMenu(app, evt, choice, roots, {
			onRename: () => actions.onRenameChoice(choice),
			onToggle: () => actions.onToggleCommand(choice),
			onConfigure: () => actions.onConfigureChoice(choice),
			onDuplicate: () => actions.onDuplicateChoice(choice),
			onDelete: () => actions.onDeleteChoice(choice),
			onMove: (targetId) => actions.onMoveChoice(choice, targetId),
		});
	}
</script>

<div
    class="choiceListItem"
    role="button"
    tabindex="0"
    aria-haspopup="menu"
    aria-label={`Context menu for ${choice.name}`}
    oncontextmenu={onContextMenu}
>
	<span class="choiceListItemName" bind:this={nameElement}></span>

	<RightButtons
		onDragHandleDown={startDrag}
		onDeleteChoice={() => actions.onDeleteChoice(choice)}
		onConfigureChoice={() => actions.onConfigureChoice(choice)}
		onToggleCommand={() => actions.onToggleCommand(choice)}
		onDuplicateChoice={() => actions.onDuplicateChoice(choice)}
		choiceName={choice.name}
		commandEnabled={choice.command}
		{showConfigureButton}
		{dragDisabled}
		showDuplicateButton={true}
	/>
</div>

<style></style>
