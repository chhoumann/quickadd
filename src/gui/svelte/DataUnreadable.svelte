<script lang="ts">
	import ObsidianIcon from "../components/ObsidianIcon.svelte";

	let {
		what,
	}: {
		/** Noun phrase naming what could not be read ("this macro's commands"). */
		what: string;
	} = $props();
</script>

<!--
  Shown when a value in data.json could not be READ - not when something threw.
  The distinction is the whole point of this card existing next to MountFailed:
  nothing is broken in QuickAdd, so "include the message below if you report
  this" would send the user to file a bug about their own file, and there is no
  error message to give them anyway.

  What they need instead is the three things below: that we could not read it,
  that we have not touched it and will not, and where it lives. Same promise the
  choice list makes for an unreadable folder (ChoicesUnavailable.svelte) - kept
  as a separate component rather than a shared one because that card's copy is
  specifically about the choice tree, and a card that says the wrong noun is
  worse than one more small component.

  Deliberately offers no button. Anything that could rewrite data.json would
  destroy the very value the user needs in order to recover.
-->
<div class="qaDataUnreadable">
	<div class="qaDataUnreadableHead">
		<ObsidianIcon iconId="alert-triangle" size={16} />
		<span class="qaDataUnreadableTitle">QuickAdd couldn't read {what}</span>
	</div>
	<p class="qaDataUnreadableBody">
		The saved value isn't in a shape QuickAdd understands, so it can't be shown
		or edited here. Nothing has been changed or deleted, and QuickAdd will not
		overwrite it.
	</p>
	<p class="qaDataUnreadableBody">
		It's stored in <code>.obsidian/plugins/quickadd/data.json</code> inside this
		vault. Make a copy of that file before editing it.
	</p>
</div>

<style>
	.qaDataUnreadable {
		border: 1px solid var(--background-modifier-border);
		border-radius: var(--radius-m);
		padding: 12px 14px;
		margin: 4px 0 8px;
		background: var(--background-secondary);
	}

	.qaDataUnreadableHead {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--text-warning, var(--text-normal));
	}

	.qaDataUnreadableTitle {
		font-weight: var(--font-semibold);
		color: var(--text-normal);
	}

	.qaDataUnreadableBody {
		margin: 8px 0 0;
		color: var(--text-muted);
		font-size: var(--font-ui-small, 13px);
		max-width: 68ch;
	}
</style>
