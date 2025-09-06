<script lang="ts">
	import type IChoice from "../../types/choices/IChoice";
	import RightButtons from "./ChoiceItemRightButtons.svelte";
	import { createEventDispatcher } from "svelte";
	import { Component, htmlToMarkdown, MarkdownRenderer, type App } from "obsidian";
	import { showChoiceContextMenu } from "./contextMenu";

	export let choice: IChoice;
	export let app: App;
	export let roots: IChoice[];
	export let dragDisabled: boolean;
	export let startDrag: (e: Event) => void;
	let showConfigureButton: boolean = true;
	const dispatcher = createEventDispatcher();

	function deleteChoice() {
		dispatcher("deleteChoice", { choice });
	}

	function configureChoice() {
		dispatcher("configureChoice", { choice });
	}

	function toggleCommandForChoice() {
		dispatcher("toggleCommand", { choice });
	}

	function duplicateChoice() {
		dispatcher("duplicateChoice", { choice });
	}

	const cmp = new Component();
	let nameElement: HTMLSpanElement;

	$: {
		if (nameElement) {
			nameElement.innerHTML = "";
			const nameHTML = htmlToMarkdown(choice.name);
			MarkdownRenderer.renderMarkdown(
				nameHTML,
				nameElement,
				"/",
				cmp
			);
		}
	}

	function onContextMenu(evt: MouseEvent) {
		showChoiceContextMenu(app, evt, choice, roots, {
			onToggle: () => toggleCommandForChoice(),
			onConfigure: () => configureChoice(),
			onDuplicate: () => duplicateChoice(),
			onDelete: () => deleteChoice(),
			onMove: (targetId) => dispatcher("moveChoice", { choice, targetId }),
		});
	}
</script>

<div class="choiceListItem" role="button" tabindex="0" on:contextmenu={onContextMenu}>
	<span class="choiceListItemName" bind:this={nameElement} />

	<RightButtons
		on:dragHandleDown={startDrag}
		on:deleteChoice={deleteChoice}
		on:configureChoice={configureChoice}
		on:toggleCommand={toggleCommandForChoice}
		on:duplicateChoice={duplicateChoice}
		bind:choiceName={choice.name}
		bind:commandEnabled={choice.command}
		bind:showConfigureButton
		bind:dragDisabled
		showDuplicateButton={true}
	/>
</div>

<style></style>
