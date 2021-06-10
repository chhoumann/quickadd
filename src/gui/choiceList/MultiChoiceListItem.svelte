<script lang="ts">
    import Icon from "svelte-awesome/components/Icon.svelte";
    import {faChevronDown} from "@fortawesome/free-solid-svg-icons";
    import ChoiceList from "./ChoiceList.svelte";
    import MultiChoice from "../../types/choices/multiChoice";

    export let choice: MultiChoice;
    export let collapseId: string;
</script>

<div>
    <div class="multiChoiceListItem">
        <div class="multiChoiceListItemName clickable" on:click={() => choice.collapsed = !choice.collapsed}>
            <Icon data={faChevronDown} style={`transform:rotate(${choice.collapsed ? -180 : 0}deg)`} />
            <span>{choice.name}</span>
        </div>

        <button>Configure</button>
        <span class="multiChoiceListItemDelete">❌</span>
    </div>

    {#if (!collapseId && choice.id !== collapseId) && !choice.collapsed}
        <div class="nestedChoiceList">
            <ChoiceList bind:multiChoice={choice} bind:choices={choice.choices} />
        </div>
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

    .multiChoiceListItemDelete:hover {
        cursor: pointer;
    }

    .nestedChoiceList {
        padding-left: 25px;
    }
</style>
