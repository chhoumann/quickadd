<script lang="ts">
    import { onMount } from 'svelte';
    import { setIcon } from 'obsidian';
    
    export let iconId: string;
    export let size: number = 16;
    
    let iconEl: HTMLElement;
    
    onMount(() => {
        if (iconEl) {
            setIcon(iconEl, iconId);
            // Apply size styling
            const svgEl = iconEl.querySelector('svg');
            if (svgEl) {
                svgEl.setAttribute('width', `${size}`);
                svgEl.setAttribute('height', `${size}`);
            }
        }
    });
</script>

<span bind:this={iconEl} class="quickadd-icon" style="display: inline-flex; align-items: center;"></span>

<style>
    .quickadd-icon :global(svg) {
        display: inline-block;
        vertical-align: middle;
    }
</style>