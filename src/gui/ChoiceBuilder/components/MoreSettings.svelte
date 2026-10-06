<script lang="ts">
import { untrack, type Snippet } from "svelte";
import ObsidianIcon from "../../components/ObsidianIcon.svelte";
import { type MoreSettingsChoice, moreSettingsOpen, setMoreSettingsOpen } from "../moreSettings";

/**
 * The settings a builder keeps out of the way, behind one row that shows
 * them in place. Open from the start when one of them is set.
 */
let {
	choice,
	children,
}: {
	choice: MoreSettingsChoice;
	children: Snippet;
} = $props();

// Decided once, when the builder opens: turning a setting off must not
// close the section around it.
let open = $state(untrack(() => moreSettingsOpen($state.snapshot(choice) as MoreSettingsChoice)));

function toggle() {
	open = !open;
	setMoreSettingsOpen(choice.id, open);
}
</script>

<div class="qaMoreSettings" class:is-open={open}>
	<div class="setting-group">
		<div class="setting-items">
			<!-- The whole row toggles, for a pointer; the button is the control
			     for a keyboard and a screen reader. tabindex -1, as Obsidian's own
			     rows: its settings keys move focus between rows. mod-navigable, as
			     Obsidian's rows that open more settings: a phone keeps it on one
			     line with its chevron. -->
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
			<div
				class="setting-item mod-navigable qaMoreSettingsRow"
				tabindex="-1"
				onclick={(event) => {
					if (!(event.target as HTMLElement).closest("button")) toggle();
				}}
			>
				<div class="setting-item-info">
					<div class="setting-item-name">More settings</div>
				</div>
				<div class="setting-item-control">
					<button
						type="button"
						class="clickable-icon qaMoreSettingsChevron"
						aria-label="More settings"
						aria-expanded={open}
						onclick={toggle}
					>
						<ObsidianIcon iconId="chevron-right" />
					</button>
				</div>
			</div>
		</div>
	</div>
	{#if open}
		{@render children()}
	{/if}
</div>

<style>
	/* Spaced from the group above as Obsidian spaces adjacent groups. */
	.qaMoreSettings {
		margin-top: var(--size-4-6);
	}

	/* The sequence page hands its settings in a wrapper, where Obsidian's
	   space between adjacent groups does not reach its first group. */
	.qaMoreSettings > .setting-group + :global(*) > :global(.setting-group:first-child) {
		margin-top: var(--size-4-6);
	}

	.qaMoreSettingsChevron :global(.quickadd-icon) {
		transition: transform 100ms ease-in-out;
	}

	.is-open .qaMoreSettingsChevron :global(.quickadd-icon) {
		transform: rotate(90deg);
	}
</style>
