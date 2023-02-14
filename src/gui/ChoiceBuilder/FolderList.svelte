<script lang="ts">
    import {faTrash} from "@fortawesome/free-solid-svg-icons";
    import Icon from "svelte-awesome/components/Icon.svelte";

    export let folders: string[];
    export let deleteFolder: (folder: string) => void;
    export const updateFolders = (newFolders: string[]) => {
        folders = newFolders;
    }
</script>

<div class="quickAddFolderListGrid quickAddCommandList">
    {#each folders as folder, i}
        <div class="quickAddCommandListItem">
            <span>{folder}</span>
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <span on:click={() => deleteFolder(folder)} class="clickable">
                <Icon data="{faTrash}" />
            </span>
        </div>
    {/each}
</div>

<style>
.quickAddCommandListItem {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

@media (min-width: 768px) {
     .quickAddFolderListGrid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        column-gap: 20px;
    }
}

.quickAddCommandList {
    max-width: 50%;
    margin: 12px auto;
}


.clickable {
    cursor: pointer;
}
</style>