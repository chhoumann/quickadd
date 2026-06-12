<script lang="ts">
	import ObsidianIcon from "../components/ObsidianIcon.svelte";
	import type {
		AssetPreviewContent,
		PreviewFile,
	} from "../../services/packagePreview";
	import { decodeAssetPreview } from "../../services/packagePreview";
	import type { AssetImportMode } from "../../services/packageImportService";
	import type { QuickAddPackage } from "../../types/packages/QuickAddPackage";
	import { tooltip } from "../shared/tooltip";

	let {
		file,
		pkg,
		mode,
		destinationPath,
		destinationExists,
		reviewed = false,
		onPathInput,
		onModeChange,
		onReviewed,
	}: {
		file: PreviewFile;
		pkg: QuickAddPackage;
		mode: AssetImportMode;
		destinationPath: string;
		destinationExists: boolean;
		/** Whether this gate-required file has been opened toward the gate. */
		reviewed?: boolean;
		onPathInput: (value: string) => void;
		onModeChange: (mode: AssetImportMode) => void;
		onReviewed: (path: string) => void;
	} = $props();

	let expanded = $state(false);
	// Derived (not cached $state) so a re-paste that reuses this row for a
	// different package/file decodes the CURRENT content, never a stale blob.
	const content = $derived<AssetPreviewContent | null>(
		expanded ? decodeAssetPreview(pkg, file.originalPath) : null,
	);
	const previewId = $derived(
		`qa-file-preview-${file.originalPath.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
	);

	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function toggle() {
		expanded = !expanded;
		if (expanded && file.requiresReview) onReviewed(file.originalPath);
	}

	function onDestinationInput(event: Event) {
		onPathInput((event.currentTarget as HTMLInputElement).value);
	}

	function onActionChange(event: Event) {
		onModeChange(
			(event.currentTarget as HTMLSelectElement).value as AssetImportMode,
		);
	}
</script>

<div class="qa-import-file" class:overwrite={destinationExists}>
	<div class="qa-import-file-head">
		<ObsidianIcon
			iconId={destinationExists ? "file-warning" : "file-plus"}
			size={16}
		/>
		<span class="qa-import-file-status" class:overwrite={destinationExists}>
			{destinationExists ? "Will overwrite" : "New file"}
		</span>
		<span class="qa-import-file-arrow" aria-hidden="true">→</span>
		<span class="qa-import-file-dest">{destinationPath}</span>
	</div>

	<div class="qa-import-file-badges">
		{#if file.executable}
			<span
				class="qa-import-file-exec"
				use:tooltip={"Runs as code when its choice runs. It can read, change, or delete files in your vault and access the network."}
				>Executable</span
			>
		{/if}
		{#if reviewed && mode !== "skip" && file.requiresReview}
			<span class="qa-import-file-reviewed">
				<ObsidianIcon iconId="check" size={12} /> Reviewed
			</span>
		{/if}
		{#if file.orphan}
			<span
				class="qa-import-file-orphan"
				use:tooltip={"Bundled in this package but not referenced by any choice."}
				>Unused</span
			>
		{/if}
		<span class="qa-import-file-size">{formatBytes(file.sizeBytes)}</span>
	</div>

	<div class="qa-import-file-fields">
		<label class="qa-import-file-field">
			<span class="qa-import-file-field-name">Destination</span>
			<input
				type="text"
				value={destinationPath}
				oninput={onDestinationInput}
				placeholder="vault/path/to/file"
				disabled={mode === "skip"}
			/>
		</label>
		<label class="qa-import-file-field">
			<span class="qa-import-file-field-name">Action</span>
			<select class="dropdown" value={mode} onchange={onActionChange}>
				<option value="write">Write</option>
				{#if destinationExists}
					<option value="overwrite">Overwrite</option>
				{/if}
				<option value="skip">Skip</option>
			</select>
		</label>
	</div>

	{#if file.requiresReview && mode === "skip"}
		<p class="qa-import-file-skip-warn" role="note">
			Won't be written. Any choice that uses this script will run whatever
			file already exists at this path after import, not the contents you
			reviewed.
		</p>
	{/if}

	<button
		type="button"
		class="qa-import-file-toggle"
		aria-expanded={expanded}
		aria-controls={previewId}
		onclick={toggle}
	>
		<span class="qa-import-file-chevron" class:open={expanded}>
			<ObsidianIcon iconId="chevron-right" size={14} />
		</span>
		<span>{expanded ? "Hide contents" : "View contents"}</span>
	</button>

	<div
		class="qa-import-file-preview-wrap"
		class:open={expanded}
		id={previewId}
	>
		<div class="qa-import-file-preview-inner">
			{#if content}
				<div class="qa-import-file-preview">
					{#if content.error}
						<p class="qa-import-file-error">
							Preview unavailable: {content.error}
						</p>
					{:else}
						{#if content.looksMinified}
							<p class="qa-import-file-warn">
								Minified: cannot be visually reviewed. Import
								only if you trust the source.
							</p>
						{/if}
						<!-- Focusable so keyboard users can scroll long scripts. -->
						<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
						<pre
							class="qa-import-file-code"
							tabindex="0"
							role="region"
							aria-label="Contents of {file.originalPath}">{content.text}</pre>
						{#if content.truncated}
							<p class="qa-import-file-warn">
								Preview truncated. The full {file.executable
									? "script will run"
									: "file will be imported"}.
							</p>
						{/if}
					{/if}
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.qa-import-file {
		border: 1px solid var(--background-modifier-border);
		border-radius: var(--radius-m, 8px);
		padding: 0.6rem 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		background: var(--background-secondary);
	}

	.qa-import-file.overwrite {
		border-color: var(--qa-sev-critical-border);
	}

	.qa-import-file-head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}

	.qa-import-file-status {
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.01em;
		color: var(--text-muted);
	}

	.qa-import-file-status.overwrite {
		color: var(--text-error);
	}

	.qa-import-file-arrow {
		color: var(--text-muted);
	}

	.qa-import-file-dest {
		font-family: var(--font-monospace);
		font-size: 0.85rem;
		overflow-wrap: anywhere;
	}

	.qa-import-file-badges {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		align-items: center;
	}

	.qa-import-file-orphan {
		display: inline-flex;
		padding: 0.05rem 0.4rem;
		border-radius: var(--radius-s, 4px);
		font-size: 0.7rem;
		background: var(--background-modifier-hover);
		/* --text-normal (not --text-muted) so the badge clears AA on the hover
		   surface in dark themes too. */
		color: var(--text-normal);
		cursor: help;
	}

	.qa-import-file-exec {
		display: inline-flex;
		padding: 0.05rem 0.4rem;
		border-radius: var(--radius-s, 4px);
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		background: var(--qa-sev-critical-pill);
		color: #fff;
		cursor: help;
	}

	.qa-import-file-reviewed {
		display: inline-flex;
		align-items: center;
		gap: 0.15rem;
		font-size: 0.72rem;
		color: var(--text-success, var(--color-green, #0aa344));
	}

	.qa-import-file-size {
		font-size: 0.72rem;
		color: var(--text-faint);
		margin-left: auto;
	}

	/* Obsidian Setting-row geometry: field name on the left at --text-normal,
	   control docked right at its native height — not a stacked label-above
	   form field (which read as non-native). */
	.qa-import-file-fields {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.qa-import-file-field {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.qa-import-file-field-name {
		flex: 1 1 auto;
		min-width: 0;
		color: var(--text-normal);
	}

	.qa-import-file-field input {
		flex: 0 1 300px;
		min-width: 0;
	}

	.qa-import-file-field select {
		flex: 0 0 auto;
	}

	/* The native Obsidian input/dropdown focus box-shadow handles focus; no
	   custom outline (which would read as non-native). */

	.qa-import-file-field input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.qa-import-file-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		align-self: flex-start;
		background: transparent;
		border: none;
		box-shadow: none;
		padding: 0.1rem 0.2rem;
		margin-left: -0.2rem;
		cursor: pointer;
		color: var(--text-accent);
		font-size: 0.85rem;
		border-radius: var(--radius-s, 4px);
	}

	.qa-import-file-toggle:hover {
		color: var(--interactive-accent-hover, var(--text-accent));
		text-decoration: underline;
	}

	.qa-import-file-toggle:focus-visible {
		outline: 2px solid var(--interactive-accent);
		outline-offset: 1px;
	}

	.qa-import-file-chevron {
		display: inline-flex;
		transition: transform 180ms ease;
	}

	.qa-import-file-chevron.open {
		transform: rotate(90deg);
	}

	.qa-import-file-preview-wrap {
		display: grid;
		grid-template-rows: 0fr;
		transition: grid-template-rows 200ms ease;
	}

	.qa-import-file-preview-wrap.open {
		grid-template-rows: 1fr;
	}

	.qa-import-file-preview-inner {
		overflow: hidden;
		min-height: 0;
	}

	.qa-import-file-preview {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding-top: 0.2rem;
	}

	.qa-import-file-warn {
		margin: 0;
		color: var(--text-warning, var(--text-muted));
		font-size: var(--font-ui-smaller, 0.85rem);
	}

	.qa-import-file-skip-warn {
		margin: 0;
		padding: 0.4rem 0.5rem;
		border-radius: var(--radius-s, 4px);
		background: var(--qa-sev-warning-wash);
		color: var(--text-normal);
		font-size: var(--font-ui-smaller, 0.85rem);
		line-height: 1.4;
	}

	.qa-import-file-error {
		margin: 0;
		color: var(--text-error);
		font-size: var(--font-ui-smaller, 0.85rem);
	}

	.qa-import-file-code {
		margin: 0;
		max-height: 240px;
		overflow: auto;
		padding: 0.5rem 0.6rem;
		border-radius: var(--radius-s, 4px);
		background: var(--background-modifier-form-field);
		border: 1px solid var(--background-modifier-border);
		font-family: var(--font-monospace);
		font-size: 0.8rem;
		line-height: 1.5;
		white-space: pre;
		tab-size: 4;
	}

	.qa-import-file-code:focus-visible {
		outline: 2px solid var(--interactive-accent);
		outline-offset: 1px;
	}

	@media (max-width: 600px) {
		/* Stack control under its name and let it use the full width on narrow
		   screens, where a right-docked control would be cramped. */
		.qa-import-file-field {
			flex-wrap: wrap;
			gap: 0.25rem;
		}

		.qa-import-file-field input,
		.qa-import-file-field select {
			flex: 1 1 100%;
		}

		.qa-import-file-size {
			margin-left: 0;
		}
	}

	:global(.is-mobile) .qa-import-file-toggle {
		min-height: 36px;
		padding: 0.4rem 0.3rem;
	}

	@media (prefers-reduced-motion: reduce) {
		.qa-import-file-chevron,
		.qa-import-file-preview-wrap {
			transition: none;
		}
	}
</style>
