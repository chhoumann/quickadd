<script lang="ts">
    import ObsidianIcon from "./ObsidianIcon.svelte";

    // Shared accessible icon button. Renders a real <button> so it is keyboard
    // operable (Enter + Space) and focusable for free — replacing the old
    // <div|span role="button" tabindex onclick onkeypress> faux-buttons across the
    // choice & macro GUIs (#1250). Visuals come from the global .qa-icon-button
    // class in styles.css (kept global so a scoped <style> can't drift / trip
    // svelte/valid-compile's css_unused_selector).
    let {
        iconId,
        label,
        onclick,
        size = 16,
        ariaPressed,
        ariaHasPopup,
        extraClass = "",
        title,
        disabled = false,
    }: {
        iconId: string;
        /** Accessible name — required so every icon-only button is labelled. */
        label: string;
        onclick?: (event: MouseEvent) => void;
        size?: number;
        /** Set for toggle buttons; the pressed STATE (not the label) conveys on/off. */
        ariaPressed?: boolean;
        ariaHasPopup?: "menu" | "dialog" | "true";
        /** Extra classes (e.g. "clickable" retained for existing test selectors). */
        extraClass?: string;
        title?: string;
        disabled?: boolean;
    } = $props();
</script>

<button
    type="button"
    class={`qa-icon-button ${extraClass}`}
    class:is-pressed={ariaPressed === true}
    aria-label={label}
    aria-pressed={ariaPressed}
    aria-haspopup={ariaHasPopup}
    {title}
    {disabled}
    onclick={onclick}
>
    <ObsidianIcon {iconId} {size} />
</button>
