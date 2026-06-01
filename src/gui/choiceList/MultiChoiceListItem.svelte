<script lang="ts">
    import ObsidianIcon from "../components/ObsidianIcon.svelte";
    import AddChoiceControls from "./AddChoiceControls.svelte";
    import ChoiceList from "./ChoiceList.svelte";
    import type IMultiChoice from "../../types/choices/IMultiChoice";
    import RightButtons from "./ChoiceItemRightButtons.svelte";
    import { untrack } from "svelte";
	import { Component, type App } from "obsidian";
    import type IChoice from "src/types/choices/IChoice";
    import { showChoiceContextMenu, showChoiceContextMenuAtElement } from "./contextMenu";
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
        forceDragDisabled = false,
        rootReorder,
        onMoveUp,
        onMoveDown,
    }: {
        choice: IMultiChoice;
        roots: IChoice[];
        collapseId: string;
        dragDisabled: boolean;
        startDrag: (e?: Event) => void;
        app: App;
        actions: ChoiceListActions;
        forceDragDisabled?: boolean;
        // Top-level onReorderChoices (see ChoiceList). Falls back to this list's own
        // handler when rendered directly (tests); in the app it is always provided.
        rootReorder?: (choices: IChoice[]) => void;
        onMoveUp?: () => void;
        onMoveDown?: () => void;
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

    const menuActions = () => ({
        onRename: () => actions.onRenameChoice(choice),
        onToggle: () => actions.onToggleCommand(choice),
        onConfigure: () => actions.onConfigureChoice(choice),
        onDuplicate: () => actions.onDuplicateChoice(choice),
        onDelete: () => actions.onDeleteChoice(choice),
        onMove: (targetId: string) => actions.onMoveChoice(choice, targetId),
    });

    function onContextMenu(evt: MouseEvent) {
        showChoiceContextMenu(app, evt, choice, roots, menuActions());
    }

    function openMenu(anchor: HTMLElement) {
        showChoiceContextMenuAtElement(app, anchor, choice, roots, menuActions());
    }

    // Nested children reordered: write the new order back to this Multi choice (the
    // choice object is shared with the root tree, so this mutates it in place), then
    // COMMIT the tree via the top-level onCommit, which re-persists ChoiceView's own
    // authoritative `choices`. We must NOT reassign it from `[...roots]` here: in a
    // cross-zone drag (root <-> folder) svelte-dnd fires two synchronous finalizes,
    // and the `roots` prop lags the source of truth within that tick — reassigning
    // from it overwrote the folder's emptying and duplicated the dragged item.
    const nestedActions: ChoiceListActions = {
        ...untrack(() => actions),
        onReorderChoices: (reordered: IChoice[]) => {
            // In-place edit keeps cross-zone IN consistent: the root zone's finalize
            // reassigns from svelte-dnd's items, which reference THIS same folder
            // object, so it must already carry the new children.
            choice.choices = reordered;
            // AND commit by id against the authoritative tree: on cross-zone OUT the
            // root finalize reassigns the tree FIRST, leaving `choice` stale — by-id
            // lands the edit on the real live folder node (fixes duplication).
            actions.onCommitFolder(choice.id, reordered);
        },
    };

    // Routed through the top-level handler (which reassigns the tree immutably) so
    // the collapse is reactive on first render — an in-place `choice.collapsed = …`
    // mutation isn't tracked until a reassignment has proxied the choices array.
    function toggleCollapsed() {
        // The filtered view renders a derived, force-expanded CLONE (forceDragDisabled);
        // persisting its collapse by id would silently collapse the REAL folder (only
        // visible once the filter clears). Never persist from the derived view.
        if (forceDragDisabled) return;
        actions.onToggleCollapsed(choice);
    }
</script>

<div>
    <!-- Right-click opens the context menu for mouse users; keyboard users reach the
         same actions via the "More options" button, so this row is a non-interactive
         container (no role/tabindex). -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="multiChoiceListItem" data-choice-id={choice.id} oncontextmenu={onContextMenu}>
        <button
            type="button"
            class="multiChoiceListItemName"
            aria-expanded={!choice.collapsed}
            aria-label={`Toggle ${choice.name}`}
            onclick={toggleCollapsed}
        >
            <span
                class="multiChoiceCollapseIcon"
                class:is-collapsed={choice.collapsed}
                aria-hidden="true"
            >
                <ObsidianIcon iconId="chevron-down" size={16} />
            </span>
            <span class="choiceListItemName" bind:this={nameElement}></span>
        </button>

        <RightButtons
            onDragHandleDown={startDrag}
            onDeleteChoice={() => actions.onDeleteChoice(choice)}
            onConfigureChoice={() => actions.onConfigureChoice(choice)}
            onToggleCommand={() => actions.onToggleCommand(choice)}
            onDuplicateChoice={() => actions.onDuplicateChoice(choice)}
            onOpenMenu={openMenu}
            {onMoveUp}
            {onMoveDown}
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
                    isEmptyFolder={choice.choices.length === 0}
                    {forceDragDisabled}
                    rootReorder={rootReorder ?? actions.onReorderChoices}
                    actions={nestedActions}
                />
                <!-- Add-into-folder affordance. Lives OUTSIDE the ChoiceList's
                     dndzone (it's a sibling after <ChoiceList>), so svelte-dnd
                     never treats it as a draggable item / shadow placeholder.
                     Hidden while filtering (the filtered tree is a clone that
                     must not be persisted). -->
                {#if !forceDragDisabled}
                    <div class="nestedAddRow">
                        <AddChoiceControls
                            compact
                            targetFolderId={choice.id}
                            targetFolderName={choice.name}
                            onAddChoice={actions.onAddChoice}
                        />
                    </div>
                {/if}
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

    /* Full-width collapse toggle: reset native <button> chrome to match the old
       clickable div while keeping native keyboard activation + aria-expanded. */
    .multiChoiceListItemName {
        flex: 1 0 0;
        /* Tuck the chevron into the left card-padding gutter so the Multi NAME
           lines up flush with leaf-row names — only nested children get indented
           (.nestedChoiceList below), not the root Multi row itself. -20px = the
           chevron's RENDERED box (18px) + the 2px gap, so the name lands on the
           leaf-name x. The box is 18px, not the size={16} attribute: Obsidian's
           .svg-icon class sizes the SVG via var(--icon-size) (~18px), overriding
           the attribute (verified in-app: width attr 16, computed 18, name flush).
           The lucide glyph also carries ~4.5px side-bearing, so a 2px flex gap
           yields a ~6px optical gap to the name — the prior 5px gap was ~9.5px. */
        margin-left: -20px;
        display: flex;
        align-items: center;
        gap: 2px;
        background: transparent;
        border: none;
        box-shadow: none;
        padding: 0;
        font: inherit;
        color: inherit;
        text-align: left;
        cursor: pointer;
    }

    .multiChoiceListItemName:focus-visible {
        outline: 2px solid var(--interactive-accent);
        outline-offset: 1px;
        border-radius: var(--radius-s, 4px);
    }

    /* Just the indent — the drop-into-folder ring is drawn on the ACTUAL dndzone
       (.choiceList, in ChoiceList.svelte) so the highlighted area equals the
       droppable area (WYSIWYG); it is NOT drawn on this wrapper, which extends past
       the zone to the add-row/hint. */
    .nestedChoiceList {
        padding-left: 25px;
    }

    /* The per-folder add-row is the folder's own affordance: one spacing step
       (8px) tighter than the 12px inter-row rhythm so it reads as "belongs to this
       folder". An empty folder's add-row sits below the drop band (ChoiceList's
       .qa-empty, which now owns the "Empty — …" hint as pseudo-content), getting
       the same 8px gap as a populated one. */
    .nestedAddRow {
        margin: 8px 0 0 0;
    }
</style>
