<script lang="ts">
    import {faTrash} from "@fortawesome/free-solid-svg-icons";
    import Icon from "svelte-awesome/components/Icon.svelte";

    export let folders: string[];
    export let deleteFolder: (folder: string) => void;
    export const updateFolders = (newFolders: string[]) => {
        folders = newFolders;
    }
</script>

<div class="quickAddFolderList">
    {#each folders as folder, i}
        <div class="quickAddFolderListItem">
            <span>{folder}</span>
            <span on:click={() => deleteFolder(folder)} class="clickable">
                <Icon data="{faTrash}" />
            </span>
        </div>
    {/each}
</div>

<style>
.quickAddFolderListItem {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.quickAddFolderList {
    max-width: 50%;
    margin: 12px auto;
}

.clickable {
    cursor: pointer;
}
</style>