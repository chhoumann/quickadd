<script lang="ts">
	import ObsidianIcon from "../components/ObsidianIcon.svelte";

	let {
		what,
		detail = "",
	}: {
		/** Noun phrase naming what could not be displayed ("the command list"). */
		what: string;
		/** The underlying error message, when there is one. Shown verbatim: it is
		 *  what makes a bug report actionable, and this card is otherwise a dead
		 *  end for the user. */
		detail?: string;
	} = $props();
</script>

<!--
  The default fallback for a Svelte mount that threw (see mountComponent.ts). Its
  whole job is to turn a total, silent failure — a modal that never opens, a
  settings tab that comes up blank — into a partial, visible one: this part of the
  screen is gone, everything around it still works, and here is the error text to
  put in a bug report.

  Deliberately offers no retry: re-mounting runs the same code over the same data
  and throws again.
-->
<div class="qaMountFailed">
	<div class="qaMountFailedHead">
		<ObsidianIcon iconId="alert-triangle" size={16} />
		<span class="qaMountFailedTitle">QuickAdd couldn't display {what}</span>
	</div>
	<!--
	  The body claims only what this card can actually vouch for. Two earlier
	  drafts overreached and both were wrong somewhere:
	    "nothing in your vault has been changed" - an action earlier in the same
	      flow may well have written something (adding a choice saves it, THEN
	      opens the builder).
	    "everything else on this screen still works" - not for a host whose
	      remaining controls only made sense alongside the view that failed.
	  A card that can be wrong is worse than one that says less, so this one says
	  what happened, that the failure itself changed nothing, and what to report.
	-->
	<p class="qaMountFailedBody">
		This part of QuickAdd could not be drawn, so it has been left out. Nothing
		was changed by the error. Include the message below if you report this.
	</p>
	{#if detail}
		<pre class="qaMountFailedDetail">{detail}</pre>
	{/if}
</div>

<style>
	.qaMountFailed {
		border: 1px solid var(--background-modifier-border);
		border-radius: var(--radius-m);
		padding: 12px 14px;
		margin: 4px 0 8px;
		background: var(--background-secondary);
	}

	.qaMountFailedHead {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--text-warning, var(--text-normal));
	}

	.qaMountFailedTitle {
		font-weight: var(--font-semibold);
		color: var(--text-normal);
	}

	.qaMountFailedBody {
		margin: 8px 0 0;
		color: var(--text-muted);
		font-size: var(--font-ui-small, 13px);
		max-width: 68ch;
	}

	.qaMountFailedDetail {
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
