<script lang="ts">
import { DOCS_URLS } from "../../../docs";

/**
 * Advertises the `{{` format-token autocomplete under a format field and points
 * at the docs. Hidden once the value contains `{{`. Not persisted in settings: a
 * vault-wide flag would let one stray `{{` remove the hint for good.
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
