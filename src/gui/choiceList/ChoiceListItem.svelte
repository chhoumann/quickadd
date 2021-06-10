<script lang="ts">
    import IChoice from "../../types/choices/IChoice";

    export let choice: IChoice;
</script>

<div class="multiChoiceListItem">
    <span class="multiChoiceListItemName">{choice.name}</span>
    <button>Configure</button>
    <span class="multiChoiceListItemDelete">❌</span>
</div>

<style>
    .multiChoiceListItem {
        display: flex;
        font-size: 16px;
        align-items: center;
        margin: 12px 0 0 0;
        transition: 1000ms ease-in-out;
    }

    .multiChoiceListItemName {
        flex: 1 0 0;
    }

    .multiChoiceListItemDelete:hover {
        cursor: pointer;
    }
</style>
