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
  Shown when a value in data.json could not be read, not when something threw,
  so it asks for no bug report. It says that the value could not be read, that
  QuickAdd has not touched it, and where it lives. No button: anything that could
  rewrite data.json would destroy the value the user needs to recover.
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
