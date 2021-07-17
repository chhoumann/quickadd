<script lang="ts">
    import {ChoiceType} from "../../types/choices/choiceType";
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
        <option value={ChoiceType.Template}>{ChoiceType.Template}</option>
        <option value={ChoiceType.Capture}>{ChoiceType.Capture}</option>
        <option value={ChoiceType.Macro}>{ChoiceType.Macro}</option>
        <option value={ChoiceType.Multi}>{ChoiceType.Multi}</option>
    </select>
    <button class="mod-cta" on:click={addChoice}>Add Choice</button>
</div>

<style>
    .addChoiceBox {
        margin-top: 1em;
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
        font-size: 16px;
        padding: 3px;
        border-radius: 3px;
    }
</style>