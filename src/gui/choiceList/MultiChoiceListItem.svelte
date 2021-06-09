<script lang="ts">
    import Icon from "svelte-awesome/components/Icon.svelte";
    import {faChevronDown} from "@fortawesome/free-solid-svg-icons";
    import ChoiceList from "./ChoiceList.svelte";
    import MultiChoice from "../../types/choices/multiChoice";

    export let choice: MultiChoice;
    export let id: string;
    let collapse: boolean = false;
</script>

<div>
    <div class="choiceListItem">
        <div class="choiceListItemName clickable" on:click={() => collapse = !collapse}>
            <Icon data={faChevronDown} style={`transform:rotate(${collapse ? -180 : 0}deg)`} />
            <span>{choice.name}</span>
        </div>

        <button>Configure</button>
        <span class="choiceListItemDelete">❌</span>
    </div>

    {#if !collapse}
        <div class="nestedChoiceList">
            <ChoiceList type={id} bind:choices={choice.choices} />
        </div>
    {/if}
</div>

<style>
    .choiceListItem {
        display: flex;
        font-size: 16px;
        align-items: center;
        margin: 12px 0;
    }

    .clickable:hover {
        cursor: pointer;
    }

    .choiceListItemName {
        flex: 1 0 0;
        margin-left: 5px;
    }

    .choiceListItemDelete:hover {
        cursor: pointer;
    }

    .nestedChoiceList {
        padding-left: 25px;
    }
</style>
