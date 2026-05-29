<script lang="ts">
    import ObsidianIcon from "../components/ObsidianIcon.svelte";
    import ChoiceList from "./ChoiceList.svelte";
    import type IMultiChoice from "../../types/choices/IMultiChoice";
    import RightButtons from "./ChoiceItemRightButtons.svelte";
    import { untrack } from "svelte";
	import { Component, type App } from "obsidian";
    import type IChoice from "src/types/choices/IChoice";
    import { showChoiceContextMenu } from "./contextMenu";
	import { renderChoiceName } from "./renderChoiceName";
    import type { ChoiceListActions } from "./choiceListActions";

    let {
        choice,
        roots,
        collapseId,
        dragDisabled,
        startDrag,
        app,
        actions,
    }: {
        choice: IMultiChoice;
        roots: IChoice[];
        collapseId: string;
        dragDisabled: boolean;
        startDrag: (e?: Event) => void;
        app: App;
        actions: ChoiceListActions;
    } = $props();

    let showConfigureButton = $state(true);
    let nameElement = $state<HTMLSpanElement>();
	const cmp = new Component();

	$effect(() => {
		if (nameElement) {
			renderChoiceName(choice.name, nameElement, cmp, app);
		}
	});

	// renderChoiceName passes cmp to MarkdownRenderer.render as the lifecycle owner;
	// unload it on destroy so any registered child components are disposed (no deps
	// here, so the teardown runs only when this item is destroyed).
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

    // Nested children reordered: write the new order back to this Multi choice, then
    // bubble the whole (shallow-cloned) root tree up so the top-level handler persists
    // it. Calls the PARENT's onReorderChoices (not nestedActions) — no loop.
    const nestedActions: ChoiceListActions = {
        ...untrack(() => actions),
        onReorderChoices: (reordered: IChoice[]) => {
            choice.choices = reordered;
            actions.onReorderChoices([...roots]);
        },
    };

    function toggleCollapsed() {
        choice.collapsed = !choice.collapsed;
    }
</script>

<div>
    <div
        class="multiChoiceListItem"
        role="button"
        tabindex="0"
        aria-haspopup="menu"
        aria-label={`Context menu for ${choice.name}`}
        oncontextmenu={onContextMenu}
    >
        <div
            role="button"
            tabindex="0"
            class="multiChoiceListItemName clickable"
            onclick={toggleCollapsed}
            onkeypress={(e) => (e.key === 'Enter' || e.key === ' ') && toggleCollapsed()}
        >
            <div
                class="multiChoiceCollapseIcon"
                class:is-collapsed={choice.collapsed}
            >
                <ObsidianIcon iconId="chevron-down" size={16} />
            </div>
            <span class="choiceListItemName" bind:this={nameElement}></span>
        </div>

        <RightButtons
            onDragHandleDown={startDrag}
            onDeleteChoice={() => actions.onDeleteChoice(choice)}
            onConfigureChoice={() => actions.onConfigureChoice(choice)}
            onToggleCommand={() => actions.onToggleCommand(choice)}
            onDuplicateChoice={() => actions.onDuplicateChoice(choice)}
            {showConfigureButton}
            {dragDisabled}
            choiceName={choice.name}
            commandEnabled={choice.command}
            showDuplicateButton={true}
        />
    </div>

    {#if !collapseId || (collapseId && choice.id !== collapseId)}
        {#if !choice.collapsed}
            <div class="nestedChoiceList">
                <ChoiceList
                    {app}
                    roots={roots}
                    choices={choice.choices}
                    actions={nestedActions}
                />
            </div>
        {/if}
    {/if}
</div>

<style>
    .multiChoiceListItem {
        display: flex;
        font-size: 16px;
        align-items: center;
        margin: 12px 0 0 0;
    }

    .multiChoiceCollapseIcon {
        display: inline-flex;
        transition: transform 0.2s ease-in-out;
    }

    .multiChoiceCollapseIcon.is-collapsed {
        transform: rotate(-180deg);
    }

    .clickable:hover {
        cursor: pointer;
    }

    .multiChoiceListItemName {
        flex: 1 0 0;
        margin-left: 5px;
    }

    .nestedChoiceList {
        padding-left: 25px;
    }
</style>
