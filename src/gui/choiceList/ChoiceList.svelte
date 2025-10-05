<script lang="ts">
import type IChoice from "../../types/choices/IChoice";
import { SHADOW_PLACEHOLDER_ITEM_ID } from "svelte-dnd-action";
import type { DndEvent } from "svelte-dnd-action";
import { createEventDispatcher } from "svelte";
import type { App } from "obsidian";

export let choices: IChoice[] = [];
export let roots: IChoice[] | undefined;
export let app: App;
// When true, keeps drag disabled regardless of user action
export const forceDragDisabled: boolean = false;
let _collapseId: string;
let _dragDisabled: boolean = true;

const dispatcher = createEventDispatcher();

function emitChoicesReordered() {
	dispatcher("reorderChoices", { choices });
}

function _handleConsider(e: CustomEvent<DndEvent>) {
	const {
		items: newItems,
		info: { id },
	} = e.detail;
	_collapseId = id;

	// Remove internal placeholder item from state to avoid ghost gaps
	const sanitized = (newItems as IChoice[]).filter(
		(it) => it.id !== SHADOW_PLACEHOLDER_ITEM_ID
	);
	choices = sanitized;
}

function _handleSort(e: CustomEvent<DndEvent>) {
	const { items: newItems } = e.detail;
	_collapseId = "";

	// Remove internal placeholder item from state to avoid ghost gaps
	const sanitized = (newItems as IChoice[]).filter(
		(it) => it.id !== SHADOW_PLACEHOLDER_ITEM_ID
	);
	choices = sanitized;

	// Always re-disable dragging when the sort finalizes
	_dragDisabled = true;

	emitChoicesReordered();
}

function _startDrag(e: Event) {
	if (forceDragDisabled) return; // Do not enable drag while forcing disabled (e.g., during filtering)
	// prevent focus/selection side-effects before enabling drag
	// @ts-expect-error
	if (typeof e?.preventDefault === "function") e.preventDefault();
	_dragDisabled = false;
}
</script>

<div
        use:dndzone={{items: choices, dragDisabled, dropTargetStyle: {}}}
        on:consider={handleConsider}
        on:finalize={handleSort}
        class="choiceList"
        style="{choices.length === 0 ? 'padding-bottom: 0.5rem' : ''}">
    {#each choices.filter(c => c.id !== SHADOW_PLACEHOLDER_ITEM_ID) as choice(choice.id)}
        {#if choice.type !== "Multi"}
            <ChoiceListItem
                    {app}
                    roots={roots ?? choices}
                    bind:dragDisabled={dragDisabled}
                    on:deleteChoice
                    on:configureChoice
                    on:toggleCommand
                    on:duplicateChoice
                    on:moveChoice
                    startDrag={startDrag}
                    bind:choice
            />
        {:else}
            <MultiChoiceListItem
                    {app}
                    roots={roots ?? choices}
                    bind:dragDisabled={dragDisabled}
                    on:deleteChoice
                    on:configureChoice
                    on:toggleCommand
                    on:duplicateChoice
                    on:moveChoice
                    startDrag={startDrag}
                    bind:collapseId
                    bind:choice
            />
        {/if}
    {/each}
</div>

<style>
.choiceList {
    width: auto;
    border: 0 solid black;
    overflow-y: auto;
    height: auto;
}
</style>
