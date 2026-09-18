<script lang="ts">
	import type { PackagePreview } from "../../services/packagePreview";
	let { preview, fullyReviewed, acknowledged = $bindable(false) }: {
		preview: PackagePreview | null;
		fullyReviewed: boolean;
		acknowledged?: boolean;
	} = $props();
	const critical = $derived(preview?.summary.hasCritical);
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
		<section class="ackGate" class:critical={critical}>
			<label class="ackGate-label">
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
				<p id="qa-import-ack-hint" class="ackGate-hint">
					Open “View contents” on each of the {criticalScriptCount} executable
					script{criticalScriptCount === 1 ? "" : "s"} above to enable this.
				</p>
			{/if}
		</section>
<style>
	.ackGate {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.75rem;
		border: 1px solid var(--background-modifier-border);
		border-radius: var(--radius-m, 8px);
		background: var(--background-secondary);
	}

	.ackGate.critical {
		border-color: var(--qa-sev-critical-border);
	}

	.ackGate-label {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		font-weight: 600;
		cursor: pointer;
	}

	.ackGate-label:has(input:disabled) {
		cursor: not-allowed;
		opacity: 0.6;
	}

	.ackGate-label input {
		margin-top: 0.2rem;
		flex-shrink: 0;
	}

	.ackGate-label input:focus-visible {
		outline: 2px solid var(--interactive-accent);
		outline-offset: 2px;
	}

	.ackGate-hint {
		margin: 0;
		font-size: var(--font-ui-smaller, 0.8rem);
		color: var(--text-muted);
	}

</style>
