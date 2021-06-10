<script lang="ts">
    import Icon from "svelte-awesome/components/Icon.svelte";
    import {faChevronDown} from "@fortawesome/free-solid-svg-icons";
    import ChoiceList from "./ChoiceList.svelte";
    import IMultiChoice from "../../types/choices/IMultiChoice";
    import RightButtons from "./ChoiceItemRightButtons.svelte";
    import {createEventDispatcher} from "svelte";

    export let choice: IMultiChoice;
    export let collapseId: string;
    export let dragDisabled: boolean;
    let showConfigureButton: boolean = false;

    const dispatcher = createEventDispatcher();

    function deleteChoice(e: any) {
        dispatcher('deleteChoice', {choiceId: choice.id, choiceName: choice.name});
    }

</script>

<div>
    <div class="multiChoiceListItem">
        <div class="multiChoiceListItemName clickable" on:click={() => choice.collapsed = !choice.collapsed}>
            <Icon data={faChevronDown} style={`transform:rotate(${choice.collapsed ? -180 : 0}deg)`} />
            <span>{choice.name}</span>
        </div>

        <RightButtons
            on:mousedown
            on:touchstart
            on:deleteChoice={deleteChoice}
            bind:showConfigureButton
            bind:dragDisabled
        />
    </div>

    {#if !collapseId || (collapseId && choice.id !== collapseId)}
        {#if !choice.collapsed}
            <div class="nestedChoiceList">
                <ChoiceList
                        on:deleteChoice
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
