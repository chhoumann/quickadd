<script lang="ts">
    import { setIcon } from 'obsidian';

    let { iconId, size = 16 }: { iconId: string; size?: number } = $props();

    let iconEl = $state<HTMLElement>();

    // Rendering the icon writes to the DOM (setIcon), so this is $effect, not
    // $derived. Reading iconEl/iconId/size makes them dependencies, so the icon
    // re-renders when any of them changes.
    $effect(() => {
        if (!iconEl || !iconId) return;
        setIcon(iconEl, iconId);
        const svgEl = iconEl.querySelector('svg');
        if (svgEl) {
            svgEl.setAttribute('width', `${size}`);
            svgEl.setAttribute('height', `${size}`);
        }
    });
</script>

<span bind:this={iconEl} class="quickadd-icon"></span>

<style>
    .quickadd-icon {
        display: inline-flex;
        align-items: center;
    }

    .quickadd-icon :global(svg) {
        display: inline-block;
        vertical-align: middle;
    }
</style>