<script lang="ts">
	import type { PackagePreview } from "../../services/packagePreview";
	let { preview, fullyReviewed, reasonId, acknowledged = $bindable(false) }: {
		preview: PackagePreview | null;
		fullyReviewed: boolean;
		/** The footer text saying what is left before Import. */
		reasonId: string | undefined;
		acknowledged?: boolean;
	} = $props();
	// Scripts the review can show: bundled files and choices' inline code.
	const reviewableCount = $derived(
		(preview?.criticalScriptPaths.length ?? 0) +
			(preview?.choices.filter((choice) => choice.inlineScripts.length > 0)
				.length ?? 0),
	);
	const hasUnbundledScript = $derived(
		preview?.missingReferences.some((ref) => ref.asScript) ?? false,
	);
	// The checkbox only claims a script review when there are scripts to open;
	// otherwise the copy stays honest about why no code is shown.
	const ackLabel = $derived(
		reviewableCount > 0
			? hasUnbundledScript
				? "I have reviewed each script shown above and trust the source, including scripts that are not included and cannot be shown."
				: "I have reviewed each script above and trust the source."
			: hasUnbundledScript
				? "This package runs scripts that are not included and cannot be reviewed. I trust the source."
				: "I understand this package can run code, and I trust the source.",
	);
</script>

<section class="qa-import-ack">
	<label class="qa-import-ack-label" class:is-disabled={!fullyReviewed}>
		<input
			id="qa-import-ack-checkbox"
			type="checkbox"
			checked={acknowledged}
			disabled={!fullyReviewed}
			aria-describedby={reasonId}
			onchange={(event) =>
				(acknowledged = (
					event.currentTarget as HTMLInputElement
				).checked)}
		/>
		<span>{ackLabel}</span>
	</label>
</section>

<style>
	.qa-import-ack-label {
		display: flex;
		align-items: flex-start;
		gap: var(--size-4-2);
		font-size: var(--font-ui-small);
		line-height: var(--line-height-tight);
		cursor: var(--cursor);
	}

	.qa-import-ack-label.is-disabled {
		cursor: not-allowed;
		color: var(--text-muted);
	}

	.qa-import-ack-label input {
		flex-shrink: 0;
		margin: 0;
	}
</style>
