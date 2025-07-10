<script lang="ts">
    import ObsidianIcon from "../components/ObsidianIcon.svelte";

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
            <span 
                role="button"
                tabindex="0"
                on:click={() => deleteFolder(folder)}
                on:keypress={(e) => (e.key === 'Enter' || e.key === ' ') && deleteFolder(folder)}
                class="clickable"
            >
                <ObsidianIcon iconId="trash-2" size={16} />
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