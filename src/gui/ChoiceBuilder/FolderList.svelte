<script lang="ts">
    import IconButton from "../components/IconButton.svelte";
    import type { FolderListProps } from "./folderListProps.svelte";

    let { folders, deleteFolder }: FolderListProps = $props();
</script>

<div class="quickAddFolderListGrid quickAddCommandList">
    {#each folders as folder (folder)}
        <div class="quickAddCommandListItem">
            <span>{folder}</span>
            <IconButton
                iconId="trash-2"
                label={`Remove folder ${folder}`}
                onclick={() => deleteFolder(folder)}
            />
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
</style>
