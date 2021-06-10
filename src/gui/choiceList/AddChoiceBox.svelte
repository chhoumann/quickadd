<script lang="ts">
    import {ChoiceType} from "../../types/choices/choiceType";

    let name: string;
    let type: ChoiceType;
</script>

<div class="addChoiceBox">
    <input type="text" placeholder="Name" bind:value={name}>
    <select id="addChoiceTypeSelector" bind:value={type}>
        <option value={ChoiceType.Template}>{ChoiceType.Template}</option>
        <option value={ChoiceType.Capture}>{ChoiceType.Capture}</option>
        <option value={ChoiceType.Macro}>{ChoiceType.Macro}</option>
        <option value={ChoiceType.Multi}>{ChoiceType.Multi}</option>
    </select>
    <button>Add Choice</button>
</div>

<style>
    .addChoiceBox {
        margin-top: 1em;
        display: flex;
        align-items: center;
        justify-content: space-around;
    }

    #addChoiceTypeSelector {
        font-size: 16px;
        padding: 3px;
    }
</style>