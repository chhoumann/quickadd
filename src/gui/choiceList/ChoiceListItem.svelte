<script lang="ts">
    import Choice from "../../types/choices/choice";

    export let choice: Choice;
</script>

<div class="choiceListItem">
    <span class="choiceListItemName">{choice.name}</span>
    <button>Configure</button>
    <span class="choiceListItemDelete">❌</span>
</div>

<style>
    .choiceListItem {
        display: flex;
        font-size: 16px;
        align-items: center;
        margin: 12px 0;
        transition: 1000ms ease-in-out;
    }

    .choiceListItemName {
        flex: 1 0 0;
    }

    .choiceListItemDelete:hover {
        cursor: pointer;
    }
</style>
