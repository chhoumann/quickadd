<script lang="ts">
	import type { PackagePreview } from "../../services/packagePreview";
	let { preview, fullyReviewed, acknowledged = $bindable(false) }: {
		preview: PackagePreview | null;
		fullyReviewed: boolean;
		acknowledged?: boolean;
	} = $props();
	const criticalScriptCount = $derived(
		preview?.criticalScriptPaths.length ?? 0,
	);
	const hasUnbundledScript = $derived(
		preview?.missingReferences.some((ref) => ref.asScript) ?? false,
	);
	// The checkbox only claims a script review when there are bundled scripts to
	// open; otherwise the copy stays honest about why no code is shown.
	const ackLabel = $derived(
		criticalScriptCount > 0
			? hasUnbundledScript
				? "I have reviewed each bundled script above and trust the source, including scripts that are not included and cannot be shown."
				: "I have reviewed each script above and trust the source."
			: hasUnbundledScript
				? "This package runs scripts that are not included and cannot be reviewed. I trust the source."
				: "I understand this package can run code, and I trust the source.",
	);
</script>

<section class="qa-import-ack">
	<label class="qa-import-ack-label">
		<input
			id="qa-import-ack-checkbox"
			type="checkbox"
			checked={acknowledged}
			disabled={!fullyReviewed}
			aria-describedby={criticalScriptCount > 0 && !fullyReviewed
				? "qa-import-ack-hint"
				: undefined}
			onchange={(event) =>
				(acknowledged = (
					event.currentTarget as HTMLInputElement
				).checked)}
		/>
		<span>{ackLabel}</span>
	</label>
	{#if criticalScriptCount > 0 && !fullyReviewed}
		<p id="qa-import-ack-hint" class="qa-import-ack-hint">
			Open “View contents” on each of the {criticalScriptCount} executable
			script{criticalScriptCount === 1 ? "" : "s"} above to enable this.
		</p>
	{/if}
</section>

<style>
	.qa-import-ack {
		display: flex;
		flex-direction: column;
		gap: var(--size-4-1);
	}

	.qa-import-ack-label {
		display: flex;
		align-items: flex-start;
		gap: var(--size-4-2);
		font-size: var(--font-ui-small);
		line-height: var(--line-height-tight);
		cursor: var(--cursor);
	}

	.qa-import-ack-label:has(input:disabled) {
		cursor: not-allowed;
		color: var(--text-muted);
	}

	.qa-import-ack-label input {
		flex-shrink: 0;
		margin: 0;
	}

	.qa-import-ack-hint {
		margin: 0;
		/* Aligns under the label text: checkbox width + the label's gap. */
		padding-inline-start: calc(var(--checkbox-size) + var(--size-4-2));
		font-size: var(--font-ui-smaller);
		color: var(--text-muted);
	}
</style>
