<script lang="ts">
import { DOCS_URLS } from "../../../docs";

/**
 * Advertises the format-token autocomplete under a format field (issue #1542).
 *
 * Typing `{{` opens a list of every token, each with a one-line description, and
 * nothing in the UI said so — the reporter only found it on a hunch. The
 * affordance is two characters, so the cheapest honest fix is to name the two
 * characters, right below the caret. It doubles as the docs entry point #1541
 * deferred to this issue: the format language is the one thing you cannot guess
 * from the builder alone.
 *
 * Hidden once the value contains `{{`: the hint has done its job, and a line
 * that never goes away is the permanent chrome an "Insert token" button was
 * rejected for. Deliberately NOT persisted in settings — a per-vault flag would
 * mean a disk write from a keystroke, would not be reactive, and one stray `{{`
 * would delete the affordance vault-wide with no way back.
 */
let { value }: { value: string } = $props();

const shown = $derived(!value.includes("{{"));
</script>

{#if shown}
	<div class="qa-token-hint">
		Type <code>&#123;&#123;</code> to insert a token &middot;
		<a
			class="quickadd-docs-link"
			href={DOCS_URLS.formatSyntax}
			target="_blank"
			rel="noopener noreferrer">Format syntax</a
		>
	</div>
{/if}
