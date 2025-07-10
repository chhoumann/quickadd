<script lang="ts">
    import type {ChoiceType} from "../../types/choices/choiceType";
    import {createEventDispatcher} from "svelte";
    import {Notice} from "obsidian";

    let name: string;
    let type: ChoiceType;

    const dispatch = createEventDispatcher();

    function addChoice() {
        if (!name) {
            new Notice("Choice name is invalid.");
            return;
        }

        dispatch('addChoice', {name, type});
        name = "";
    }


</script>

<div class="addChoiceBox">
    <input type="text" placeholder="Name" bind:value={name}>
    <select id="addChoiceTypeSelector" bind:value={type}>
        <option value={"Template"}>{"Template"}</option>
        <option value={"Capture"}>{"Capture"}</option>
        <option value={"Macro"}>{"Macro"}</option>
        <option value={"Multi"}>{"Multi"}</option>
    </select>
    <button class="mod-cta" on:click={addChoice}>Add Choice</button>
</div>

<style>
    .addChoiceBox {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 10px;
        justify-content: center;
    }

    @media (max-width: 800px) {
        .addChoiceBox {
            flex-direction: column;
        }
    }

    #addChoiceTypeSelector {
        font-size: var(--font-ui-small);
        padding: var(--size-4-1) var(--size-4-3);
        border-radius: var(--button-radius);
    }
</style>