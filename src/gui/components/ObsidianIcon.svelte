<script lang="ts">
import { onMount } from "svelte";
import { setIcon } from "obsidian";

export let iconId: string;
export const size: number = 16;

let iconEl: HTMLElement;

onMount(updateIcon);

// React to changes in iconId or size after mount
$: if (iconEl) updateIcon();

function updateIcon() {
	if (iconEl && iconId) {
		setIcon(iconEl, iconId);
		const svgEl = iconEl.querySelector("svg");
		if (svgEl) {
			svgEl.setAttribute("width", `${size}`);
			svgEl.setAttribute("height", `${size}`);
		}
	}
}
</script>

<span bind:this={iconEl} class="quickadd-icon" style="display: inline-flex; align-items: center;"></span>

<style>
    .quickadd-icon :global(svg) {
        display: inline-block;
        vertical-align: middle;
    }
</style>