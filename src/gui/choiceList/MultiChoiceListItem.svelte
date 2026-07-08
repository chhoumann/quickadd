<script lang="ts">
    import ObsidianIcon from "../components/ObsidianIcon.svelte";
    import { stopDragInit } from "../shared/stopDragInit";
    import AddChoiceControls from "./AddChoiceControls.svelte";
    import ChoiceList from "./ChoiceList.svelte";
    import type IMultiChoice from "../../types/choices/IMultiChoice";
    import RightButtons from "./ChoiceItemRightButtons.svelte";
    import { untrack } from "svelte";
	import { Component, Platform, type App } from "obsidian";
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
         same actions via the "More options" button. A click anywhere on the row's
         bare surface forwards to the (focusable) name-button toggle — the row div
         itself stays a non-interactive container (no role/tabindex). -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
        class="multiChoiceListItem"
        data-choice-id={choice.id}
        oncontextmenu={onContextMenu}
        onclick={(evt) => {
            // Desktop-only: on mobile the bare row surface belongs to long-press
            // drag, and svelte-dnd-action's touch false-alarm replays a synthetic
            // click (see stopDragInit) that would double-toggle. The name button
            // (protected by stopDragInit) stays the tap affordance there.
            if (Platform.isMobile) return;
            // The name button handles its own clicks (and bubbles here); only
            // clicks on the row's bare surface toggle, so the action buttons and
            // rendered markdown links keep their own meaning.
            const target = evt.target as HTMLElement;
            if (target.closest("button, a")) return;
            toggleCollapsed();
        }}
    >
        <button
            type="button"
            class="multiChoiceListItemName"
            aria-expanded={!choice.collapsed}
            aria-label={`Toggle ${choice.name}`}
            use:stopDragInit
            onclick={toggleCollapsed}
        >
            <span
                class="qaChoiceRowIcon multiChoiceCollapseIcon"
                class:is-collapsed={choice.collapsed}
                aria-hidden="true"
            >
                <ObsidianIcon iconId="chevron-down" size={16} />
            </span>
            <span class="choiceListItemName" bind:this={nameElement}></span>
            {#if choice.collapsed && choice.choices.length > 0}
                <!-- What a closed folder hides is real information: a quiet
                     count keeps the list scannable without expanding. -->
                <span class="qaFolderCount" aria-hidden="true">{choice.choices.length}</span>
            {/if}
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
                    nested={true}
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
    /* Row surface (min-height, padding, radius, hover, rhythm) is shared with
       leaf rows and lives in styles.css — see "Choice list rows". Only the
       folder-specific pieces stay here. */

    /* Base icon = chevron-down (expanded); collapsed rotates to point RIGHT,
       matching Obsidian's own collapse grammar (file explorer, outline). */
    .multiChoiceCollapseIcon {
        transition: transform 150ms ease;
    }

    .multiChoiceCollapseIcon.is-collapsed {
        transform: rotate(-90deg);
    }

    @media (prefers-reduced-motion: reduce) {
        .multiChoiceCollapseIcon {
            transition: none;
        }
    }

    /* Full-width collapse toggle: reset native <button> chrome while keeping
       native keyboard activation + aria-expanded. It hosts the shared icon
       column (the chevron), so the folder NAME lands on the exact leaf-name x
       for free — same 8px column gap as the leaf rows. */
    .multiChoiceListItemName {
        flex: 1 1 auto;
        min-width: 0;
        align-self: stretch;
        display: flex;
        align-items: center;
        /* Obsidian's base button centers flex content; the name must not rely
           on a growing child to stay left (it stopped growing for the count). */
        justify-content: flex-start;
        gap: 8px;
        background: transparent;
        border: none;
        box-shadow: none;
        padding: 0;
        /* Obsidian's base button rule sets height: var(--input-height) (30px),
           which would make folder rows 4px taller than leaf rows — the exact
           rhythm break this redesign removes. */
        height: auto;
        min-height: 0;
        font: inherit;
        color: inherit;
        text-align: left;
        cursor: pointer;
        /* Suppress double-tap-zoom + its click delay on touch — proper touch hygiene
           for a tap target, and reduces the ghost-click the dedupe above also guards. */
        touch-action: manipulation;
    }

    /* The count reads as part of the label ("Misc · 12"), so the name must not
       grow — it keeps its ellipsis via flex-shrink + the shared min-width: 0. */
    .multiChoiceListItemName :global(.choiceListItemName) {
        flex: 0 1 auto;
    }

    .qaFolderCount {
        flex: 0 0 auto;
        color: var(--text-faint);
        font-size: var(--font-ui-smaller, 12px);
        font-variant-numeric: tabular-nums;
        line-height: 1;
    }

    .multiChoiceListItemName:focus-visible {
        outline: 2px solid var(--interactive-accent);
        outline-offset: 1px;
        border-radius: var(--radius-s, 4px);
    }

    /* Just the indent — the drop-into-folder ring is drawn on the ACTUAL dndzone
       (.choiceList, in ChoiceList.svelte) so the highlighted area equals the
       droppable area (WYSIWYG); it is NOT drawn on this wrapper, which extends past
       the zone to the add-row/hint. The ::before is an indent GUIDE under the
       parent's icon column (x = row padding 8px + half the 18px column, minus
       half the line), clarifying what belongs to the open folder. */
    .nestedChoiceList {
        position: relative;
        padding-left: 26px;
    }

    .nestedChoiceList::before {
        content: "";
        position: absolute;
        left: 16px;
        top: 3px;
        bottom: 3px;
        width: 1px;
        background: var(--background-modifier-border);
        pointer-events: none;
    }

    /* The per-folder add-row reads as a ghost row of the folder: aligned to the
       child rows' padding, one tight step (4px) below the last child. */
    .nestedAddRow {
        margin: 2px 0 4px 0;
        padding: 0 8px;
    }
</style>
