<script lang="ts">
/**
 * Obsidian-faithful dropdown (`<select class="dropdown">`). Native element so
 * Obsidian core theming applies and the value round-trips through `bind:value`.
 */
let {
	value = $bindable(""),
	options,
	disabled = false,
	ariaLabel = undefined,
	onchange = undefined,
}: {
	value?: string;
	options: { value: string; label: string }[];
	disabled?: boolean;
	ariaLabel?: string | undefined;
	onchange?: ((value: string) => void) | undefined;
} = $props();
</script>

<select
	class="dropdown"
	bind:value
	{disabled}
	aria-label={ariaLabel}
	onchange={() => onchange?.(value)}
>
	{#each options as option (option.value)}
		<option value={option.value}>{option.label}</option>
	{/each}
</select>
