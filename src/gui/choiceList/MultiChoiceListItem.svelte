<script lang="ts">
    import ObsidianIcon from "../components/ObsidianIcon.svelte";
    import ChoiceList from "./ChoiceList.svelte";
    import type IMultiChoice from "../../types/choices/IMultiChoice";
    import RightButtons from "./ChoiceItemRightButtons.svelte";
    import {createEventDispatcher} from "svelte";
	import { Component, htmlToMarkdown, MarkdownRenderer, Menu, type App } from "obsidian";
    import type IChoice from "src/types/choices/IChoice";
    import { settingsStore } from "src/settingsStore";

    export let choice: IMultiChoice;
    export let roots: IChoice[];
    export let collapseId: string;
    export let dragDisabled: boolean;
    export let startDrag: (e: Event) => void;
    export let app: App;
    let showConfigureButton: boolean = true;

    const dispatcher = createEventDispatcher();

    function deleteChoice(e: any) {
        dispatcher('deleteChoice', {choice});
    }

    function configureChoice() {
        dispatcher('configureChoice', {choice});
    }

    function toggleCommandForChoice() {
        dispatcher('toggleCommand', {choice});
    }

    function duplicateChoice() {
        dispatcher('duplicateChoice', {choice});
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
                    .setTitle(choice.command ? "Disable in Command Palette" : "Enable in Command Palette")
                    .setIcon("zap")
                    .onClick(() => toggleCommandForChoice()),
            )
            .addItem((item) => item.setTitle("Configure").setIcon("settings").onClick(() => configureChoice()))
            .addItem((item) => item.setTitle("Duplicate").setIcon("copy").onClick(() => duplicateChoice()))
            .addItem((item) => item.setTitle("Delete").setIcon("trash-2").onClick(() => deleteChoice(null)))
            .addSeparator();

        const targets = getEligibleMultiTargets(choice);
        if (targets.length === 0) {
            menu.addItem((item) => item.setTitle("Move to: (no folders)").setDisabled(true).setIcon("folder"));
        } else {
            // Flattened list of targets as top-level items
            targets.forEach((t) =>
                menu.addItem((item) =>
                    item
                        .setTitle(`Move to: ${t.path}`)
                        .setIcon("folder-open")
                        .onClick(() => dispatcher('moveChoice', { choice, targetId: t.id })),
                ),
            );
        }

        menu.showAtMouseEvent(evt);
    }

    function getEligibleMultiTargets(moving: IMultiChoice): { id: string; path: string }[] {
        const multiNodes: { id: string; path: string }[] = [];

        const walk = (list: any[], prefix: string[] = []) => {
            for (const c of list) {
                const name = c.name ?? "";
                if (c.type === 'Multi') {
                    const path = [...prefix, name];
                    if (!isInvalidTarget(moving, c)) {
                        multiNodes.push({ id: c.id, path: path.join(' / ') });
                    }
                    walk(c.choices ?? [], [...prefix, name]);
                }
            }
        };

        const source = (roots && roots.length ? roots : settingsStore.getState().choices) ?? [];
        walk(source, []);
        return multiNodes;
    }

    function isInvalidTarget(moving: IMultiChoice, target: any): boolean {
        if (target.type !== 'Multi') return true;
        if (moving.id === target.id) return true;
        // if target is within moving's subtree, it's invalid
        const ids = new Set<string>();
        const collect = (c: any) => {
            ids.add(c.id);
            if (c.type === 'Multi') c.choices?.forEach(collect);
        };
        moving.choices?.forEach(collect);
        return ids.has(target.id);
    }
</script>

<div>
    <div class="multiChoiceListItem" on:contextmenu={onContextMenu}>
        <div 
            role="button"
            tabindex="0"
            class="multiChoiceListItemName clickable" 
            on:click={() => choice.collapsed = !choice.collapsed}
            on:keypress={(e) => (e.key === 'Enter' || e.key === ' ') && (choice.collapsed = !choice.collapsed)}
        >
            <div style={`transform:rotate(${choice.collapsed ? -180 : 0}deg); transition: transform 0.2s ease-in-out; display: inline-flex;`}>
                <ObsidianIcon iconId="chevron-down" size={16} />
            </div>
            <span class="choiceListItemName" bind:this={nameElement}></span>
        </div>

        <RightButtons
            on:dragHandleDown={startDrag}
            on:deleteChoice={deleteChoice}
            on:configureChoice={configureChoice}
            on:toggleCommand={toggleCommandForChoice}
            on:duplicateChoice={duplicateChoice}
            bind:showConfigureButton
            bind:dragDisabled
            bind:choiceName={choice.name}
            bind:commandEnabled={choice.command}
            showDuplicateButton={true}
        />
    </div>

    {#if !collapseId || (collapseId && choice.id !== collapseId)}
        {#if !choice.collapsed}
            <div class="nestedChoiceList">
                <ChoiceList
                        app={app}
                        roots={roots}
                        on:deleteChoice
                        on:configureChoice
                        on:toggleCommand
                        on:duplicateChoice
                        on:moveChoice
                        bind:multiChoice={choice}
                        bind:choices={choice.choices}
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
