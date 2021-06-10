<script lang="ts">
    import {faTrash, faBars} from "@fortawesome/free-solid-svg-icons";
    import Icon from "svelte-awesome/components/Icon.svelte";

    export let dragDisabled;
</script>

<div class="rightButtonsContainer">
    <button>Configure</button>

    <div aria-label="Delete choice" class="alignIconInDivInMiddle">
        <Icon style="margin-right: 5px" data={faTrash} />
    </div>

    <div tabindex={dragDisabled ? 0 : -1}
         aria-label="Drag-handle"
         style="{dragDisabled ? 'cursor: grab' : 'cursor: grabbing'};"
         class="alignIconInDivInMiddle"
         on:mousedown
         on:touchstart
    >
        <Icon data={faBars} />
    </div>
</div>

<style>
.rightButtonsContainer {
    display: flex;
    align-items: center;
}

.alignIconInDivInMiddle {
    display: flex;
    align-items: center;
}
</style>