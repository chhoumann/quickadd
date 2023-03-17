<script lang="ts">
	import IChoice from "../../types/choices/IChoice";
	import RightButtons from "./ChoiceItemRightButtons.svelte";
	import { createEventDispatcher } from "svelte";
	import { Component, htmlToMarkdown, MarkdownRenderer } from "obsidian";

	export let choice: IChoice;
	export let dragDisabled: boolean;
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

	let nameElement: HTMLSpanElement;

	$: {
		if (nameElement) {
			nameElement.innerHTML = "";
			const nameHTML = htmlToMarkdown(choice.name);
			MarkdownRenderer.renderMarkdown(
				nameHTML,
				nameElement,
				"/",
				null as unknown as Component
			);
		}
	}
</script>

<div class="choiceListItem">
	<span class="choiceListItemName" bind:this={nameElement} />

	<RightButtons
		on:mousedown
		on:touchstart
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
