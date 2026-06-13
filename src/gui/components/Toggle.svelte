<script lang="ts">
/**
 * Obsidian-faithful toggle: a `.checkbox-container` whose `.is-enabled` /
 * `.is-disabled` classes drive the theme's visual state (same markup
 * Obsidian's `ToggleComponent` renders). Interaction lives on the container
 * (keyboard-operable via role="switch") so it works without the imperative
 * component; the inner checkbox is presentational only. See #1130 / #1250.
 */
let {
	checked = $bindable(false),
	disabled = false,
	ariaLabel = undefined,
	onchange = undefined,
}: {
	checked?: boolean;
	disabled?: boolean;
	ariaLabel?: string | undefined;
	onchange?: ((value: boolean) => void) | undefined;
} = $props();

function flip() {
	if (disabled) return;
	checked = !checked;
	onchange?.(checked);
}

function onKeydown(event: KeyboardEvent) {
	if (event.key === "Enter" || event.key === " ") {
		event.preventDefault();
		flip();
	}
}
</script>

<div
	class="checkbox-container"
	class:is-enabled={checked}
	class:is-disabled={disabled}
	role="switch"
	aria-checked={checked}
	aria-label={ariaLabel}
	tabindex={disabled ? -1 : 0}
	onclick={flip}
	onkeydown={onKeydown}
>
	<input type="checkbox" tabindex="-1" {checked} aria-hidden="true" />
</div>

<style>
/* Let clicks fall through to the container so a single handler owns toggling. */
.checkbox-container > input {
	pointer-events: none;
}
</style>
