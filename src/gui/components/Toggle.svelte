<script lang="ts">
/**
 * Obsidian-faithful toggle: a `.checkbox-container` whose `.is-enabled` /
 * `.is-disabled` classes drive the theme's visual state (same markup
 * Obsidian's `ToggleComponent` renders). Interaction lives on the container
 * (keyboard-operable via role="switch") so it works without the imperative
 * component; the inner checkbox is presentational only. See #1130 / #1250.
 *
 * `checked` is $bindable WITHOUT a fallback: choices saved before an optional
 * boolean field existed bind `undefined` here, and Svelte hard-throws
 * (props_invalid_value) on `bind:` of undefined to a prop that has a fallback,
 * aborting the whole choice-edit modal mount (#1497). Undefined renders as
 * off and becomes a real boolean on first flip.
 */
let {
	checked = $bindable(),
	disabled = false,
	ariaLabel = undefined,
	onchange = undefined,
}: {
	checked?: boolean;
	disabled?: boolean;
	ariaLabel?: string | undefined;
	onchange?: ((value: boolean) => void) | undefined;
} = $props();

const isOn = $derived(checked ?? false);

function flip() {
	if (disabled) return;
	checked = !isOn;
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
	class:is-enabled={isOn}
	class:is-disabled={disabled}
	role="switch"
	aria-checked={isOn}
	aria-label={ariaLabel}
	tabindex={disabled ? -1 : 0}
	onclick={flip}
	onkeydown={onKeydown}
>
	<input type="checkbox" tabindex="-1" checked={isOn} aria-hidden="true" />
</div>

<style>
/* Let clicks fall through to the container so a single handler owns toggling. */
.checkbox-container > input {
	pointer-events: none;
}
</style>
