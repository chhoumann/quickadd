<script lang="ts">
	import type IChoice from "../../types/choices/IChoice";
	import RightButtons from "./ChoiceItemRightButtons.svelte";
	import { createEventDispatcher } from "svelte";
	import { Component, htmlToMarkdown, MarkdownRenderer, Menu, type App } from "obsidian";
	import { settingsStore } from "src/settingsStore";

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
		evt.preventDefault();
		const menu = new Menu(app);

		menu
			.addItem((item) =>
				item
					.setTitle(
						choice.command
							? "Disable in Command Palette"
							: "Enable in Command Palette",
					)
					.setIcon("zap")
					.onClick(() => toggleCommandForChoice()),
			)
			.addItem((item) =>
				item.setTitle("Configure").setIcon("settings").onClick(() => configureChoice()),
			)
			.addItem((item) =>
				item.setTitle("Duplicate").setIcon("copy").onClick(() => duplicateChoice()),
			)
			.addItem((item) =>
				item.setTitle("Delete").setIcon("trash-2").onClick(() => deleteChoice()),
			)
			.addSeparator();

		const targets = getEligibleMultiTargets(choice);
		if (targets.length === 0) {
			menu.addItem((item) =>
				item.setTitle("Move to: (no folders)").setDisabled(true).setIcon("folder"),
			);
		} else {
			// Flattened list of targets as top-level items
			targets.forEach((t) =>
				menu.addItem((item) =>
					item
						.setTitle(`Move to: ${t.path}`)
						.setIcon("folder-open")
						.onClick(() => dispatcher("moveChoice", { choice, targetId: t.id })),
				),
			);
		}

		menu.showAtMouseEvent(evt);
	}

	function getEligibleMultiTargets(moving: IChoice): { id: string; path: string }[] {
		const multiNodes: { id: string; path: string }[] = [];

		const walk = (list: IChoice[], prefix: string[] = []) => {
			for (const c of list) {
				const name = c.name ?? "";
				if (c.type === "Multi") {
					const path = [...prefix, name];
					if (!isInvalidTarget(moving, c)) {
						multiNodes.push({ id: c.id, path: path.join(" / ") });
					}
					walk((c as any).choices ?? [], [...prefix, name]);
				}
			}
		};

		const source = (roots && roots.length ? roots : settingsStore.getState().choices) ?? [];
		walk(source, []);
		return multiNodes;
	}

	function isInvalidTarget(moving: IChoice, target: IChoice): boolean {
		if (target.type !== "Multi") return true;
		if (moving.id === target.id) return true;
		if (moving.type === "Multi") {
			// if target is within moving's subtree, it's invalid
			const ids = new Set<string>();
			const collect = (c: IChoice) => {
				ids.add(c.id);
				if (c.type === "Multi") (c as any).choices.forEach(collect);
			};
			(moving as any).choices?.forEach(collect);
			if (ids.has(target.id)) return true;
		}
		return false;
	}
</script>

<div class="choiceListItem" on:contextmenu={onContextMenu}>
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
