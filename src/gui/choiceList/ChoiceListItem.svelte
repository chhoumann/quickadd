<script lang="ts">
	import type IChoice from "../../types/choices/IChoice";
	import RightButtons from "./ChoiceItemRightButtons.svelte";
	import { createEventDispatcher } from "svelte";
	import { Component, htmlToMarkdown, MarkdownRenderer } from "obsidian";

	export let choice: IChoice;
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
</script>

<div class="choiceListItem">
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
