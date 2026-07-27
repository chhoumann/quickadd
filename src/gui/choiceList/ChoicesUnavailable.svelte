<script lang="ts">
	import ObsidianIcon from "../components/ObsidianIcon.svelte";

	let {
		what = "your choices",
		detail = "",
	}: {
		/** Noun phrase naming what could not be displayed. Defaults to the only
		 *  thing this card is ever about; it exists so the component satisfies
		 *  mountComponent's MountFallbackComponent contract (see mountComponent.ts). */
		what?: string;
		/** The underlying error message, when there is one. Shown verbatim: it is
		 *  what makes a bug report actionable, and this view is otherwise a dead
		 *  end for the user. */
		detail?: string;
	} = $props();
</script>

<!--
  Shown when the choice list cannot be rendered at all: a corrupt `choices` value
  in data.json, or an unexpected throw while mounting. The alternative - and what
  actually shipped for #1451, #1507 and #1566 - is that the whole QuickAdd
  settings tab comes up blank, which reads as "the plugin is broken" and gives
  the user nothing to act on.

  Deliberately offers no button. A "retry" re-renders the same data and throws
  again, and anything that could rewrite data.json would destroy the very value
  the user needs in order to recover. Telling them exactly where the file is, and
  that QuickAdd has not touched it, is the whole job.
-->
<div class="qaChoicesUnavailable">
	<div class="qaChoicesUnavailableHead">
		<ObsidianIcon iconId="alert-triangle" size={16} />
		<span class="qaChoicesUnavailableTitle">QuickAdd couldn't display {what}</span>
	</div>
	<p class="qaChoicesUnavailableBody">
		Something in this vault's QuickAdd settings could not be read. Your choices
		have not been changed or deleted, and QuickAdd will not overwrite them.
	</p>
	<p class="qaChoicesUnavailableBody">
		They are stored in
		<code>.obsidian/plugins/quickadd/data.json</code> inside this vault. Make a
		copy of that file before editing it.
	</p>
	{#if detail}
		<pre class="qaChoicesUnavailableDetail">{detail}</pre>
	{/if}
</div>

<style>
	.qaChoicesUnavailable {
		border: 1px solid var(--background-modifier-border);
		border-radius: var(--radius-m);
		padding: 12px 14px;
		margin: 4px 0 8px;
		background: var(--background-secondary);
	}

	.qaChoicesUnavailableHead {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--text-warning, var(--text-normal));
	}

	.qaChoicesUnavailableTitle {
		font-weight: var(--font-semibold);
		color: var(--text-normal);
	}

	.qaChoicesUnavailableBody {
		margin: 8px 0 0;
		color: var(--text-muted);
		font-size: var(--font-ui-small, 13px);
		max-width: 68ch;
	}

	.qaChoicesUnavailableDetail {
		margin: 10px 0 0;
		padding: 8px 10px;
		border-radius: var(--radius-s);
		background: var(--background-primary);
		color: var(--text-faint);
		font-size: var(--font-ui-smaller, 12px);
		white-space: pre-wrap;
		word-break: break-word;
		user-select: text;
	}
</style>
