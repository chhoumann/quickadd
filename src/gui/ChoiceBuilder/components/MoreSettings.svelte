<script lang="ts">
import { untrack, type Snippet } from "svelte";
import type ICaptureChoice from "../../../types/choices/ICaptureChoice";
import type ITemplateChoice from "../../../types/choices/ITemplateChoice";
import ObsidianIcon from "../../components/ObsidianIcon.svelte";
import { moreSettingsOpen, setMoreSettingsOpen } from "../moreSettings";

/**
 * The settings a builder keeps out of the way, behind one row that shows
 * them in place. Open from the start when one of them is set.
 */
let {
	choice,
	children,
}: {
	choice: ITemplateChoice | ICaptureChoice;
	children: Snippet;
} = $props();

// Decided once, when the builder opens: turning a setting off must not
// close the section around it.
let open = $state(untrack(() => moreSettingsOpen($state.snapshot(choice) as ITemplateChoice | ICaptureChoice)));

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
			     rows: its settings keys move focus between rows. -->
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
			<div
				class="setting-item qaMoreSettingsRow"
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

	.qaMoreSettingsRow {
		align-items: center;
		cursor: var(--cursor);
	}

	.qaMoreSettingsChevron :global(.quickadd-icon) {
		transition: transform 100ms ease-in-out;
	}

	.is-open .qaMoreSettingsChevron :global(.quickadd-icon) {
		transform: rotate(90deg);
	}
</style>
