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
		destinationIsFolder = false,
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
		/** The destination names a folder, so the file can't be written there. */
		destinationIsFolder?: boolean;
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
	// Unique per row, unlike an id built from the path: "a/b.js" and "a-b.js"
	// would sanitise to the same string and cross-wire the labels.
	const uid = $props.id();
	const previewId = `${uid}-preview`;
	const destinationId = `${uid}-destination`;
	const actionId = `${uid}-action`;
	const folderId = `${uid}-folder`;
	const fileName = $derived(file.originalPath.split("/").pop() ?? file.originalPath);

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

<!-- One card per file inside the Files .setting-group, which styles it. -->
<div class="setting-items qa-import-file">
	<div class="setting-item qa-import-file-main">
		<div class="setting-item-info">
			<div class="setting-item-name qa-import-file-name">
				<span class="qa-import-file-icon">
					<ObsidianIcon
						iconId={destinationExists ? "file-warning" : "file-plus"}
					/>
				</span>
				<span class="qa-import-file-label">{fileName}</span>
				{#if file.executable}
					<span
						class="flair qa-import-file-flair qa-flair-critical"
						use:tooltip={"Runs as code when its choice runs. It can read, change, or delete files in your vault and access the network."}
						>Executable</span
					>
				{/if}
				{#if file.orphan}
					<span
						class="flair qa-import-file-flair"
						use:tooltip={"Bundled in this package but not referenced by any choice."}
						>Unused</span
					>
				{/if}
				{#if reviewed && mode !== "skip" && file.requiresReview}
					<span class="qa-import-file-reviewed">
						<ObsidianIcon iconId="check" size={14} /> Reviewed
					</span>
				{/if}
			</div>
			<div class="setting-item-description">
				{#if destinationIsFolder}
					<span class="qa-import-file-folder" id={folderId}
						>The destination is a folder. Add a file name.</span
					>
				{:else}
					<span class:mod-warning={destinationExists}
						>{destinationExists ? "Will overwrite" : "New file"}</span
					>
				{/if}
				· {formatBytes(file.sizeBytes)}
			</div>
			{#if file.requiresReview && mode === "skip"}
				<div class="setting-item-description mod-warning" role="note">
					Won't be written. Any choice that uses this script will run
					whatever file already exists at this path after import, not the
					contents you reviewed.
				</div>
			{/if}
			<button
				type="button"
				class="qa-link-button qa-import-file-toggle"
				aria-expanded={expanded}
				aria-controls={previewId}
				onclick={toggle}
			>
				<span class="qa-import-file-chevron" class:open={expanded}>
					<ObsidianIcon iconId="chevron-right" size={14} />
				</span>
				<span>{expanded ? "Hide contents" : "View contents"}</span>
			</button>
		</div>
		<div class="setting-item-control">
			<label class="qa-visually-hidden" for={actionId}
				>Action for {file.originalPath}</label
			>
			<select
				id={actionId}
				class="dropdown"
				value={mode}
				onchange={onActionChange}
			>
				<option value="write">Write</option>
				{#if destinationExists}
					<option value="overwrite">Overwrite</option>
				{/if}
				<option value="skip">Skip</option>
			</select>
		</div>
		<div
			class="qa-import-file-preview-wrap"
			class:open={expanded}
			id={previewId}
		>
			<div class="qa-import-file-preview-inner">
				{#if content}
					<div class="qa-import-file-preview">
						{#if content.error}
							<p class="qa-import-file-note mod-error">
								Preview unavailable: {content.error}
							</p>
						{:else}
							{#if content.looksMinified}
								<p class="qa-import-file-note mod-warning">
									Minified: cannot be visually reviewed. Import
									only if you trust the source.
								</p>
							{/if}
							<span class="qa-visually-hidden" id={`${previewId}-label`}
								>Contents of {file.originalPath}</span
							>
							<!-- Focusable so keyboard users can scroll long scripts. -->
							<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
							<pre
								class="qa-import-file-code"
								tabindex="0"
								role="region"
								aria-labelledby={`${previewId}-label`}>{content.text}</pre>
							{#if content.truncated}
								<p class="qa-import-file-note mod-warning">
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

	<div class="setting-item qa-import-file-destination">
		<div class="setting-item-info">
			<label class="setting-item-name" for={destinationId}
				>Destination <span class="qa-visually-hidden"
					>for {file.originalPath}</span
				></label
			>
		</div>
		<div class="setting-item-control">
			<input
				id={destinationId}
				type="text"
				value={destinationPath}
				aria-invalid={destinationIsFolder}
				aria-describedby={destinationIsFolder ? folderId : undefined}
				oninput={onDestinationInput}
				placeholder="vault/path/to/file"
				disabled={mode === "skip"}
			/>
		</div>
	</div>
</div>

<style>
	.qa-import-file-name {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--size-4-1) var(--size-4-2);
	}

	.qa-import-file-icon {
		display: inline-flex;
		color: var(--text-muted);
		--icon-size: var(--icon-s);
	}

	.qa-import-file-label {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.qa-import-file-flair {
		margin-inline-start: 0;
		cursor: help;
	}

	.qa-import-file-folder {
		color: var(--text-error);
	}

	.qa-import-file-reviewed {
		display: inline-flex;
		align-items: center;
		gap: var(--size-2-1);
		font-size: var(--font-ui-smaller);
		color: var(--text-success);
	}

	/* The path is the point of this row: let the input take the width the
	   short "Destination" name leaves over. */
	.qa-import-file-destination {
		align-items: center;
	}

	.qa-import-file-destination .setting-item-info {
		flex: 0 0 auto;
	}

	.qa-import-file-destination input {
		flex: 1 1 auto;
		min-width: 0;
	}

	.qa-import-file-destination input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* The preview opens under the row at full width. No row gap, so the
	   collapsed preview adds no space; the preview pads itself instead. */
	.qa-import-file-main {
		flex-wrap: wrap;
		row-gap: 0;
	}

	.qa-import-file-toggle {
		margin-top: var(--size-4-1);
		font-size: var(--font-ui-smaller);
	}

	.qa-import-file-preview-wrap {
		flex-basis: 100%;
		min-width: 0;
	}

	/* Pulls the glyph's built-in side bearing back to the text edge. */
	.qa-import-file-chevron {
		display: inline-flex;
		margin-inline-start: -3px;
		transition: transform 150ms ease;
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
		gap: var(--size-4-2);
		padding-top: var(--size-4-3);
	}

	.qa-import-file-note {
		margin: 0;
		font-size: var(--font-ui-smaller);
	}

	.qa-import-file-note.mod-error {
		color: var(--text-error);
	}

	/* Obsidian's code-block look. The card already uses --code-background, so
	   the block sits on the modal background instead to stay distinct. */
	.qa-import-file-code {
		margin: 0;
		max-height: 240px;
		overflow: auto;
		padding: var(--size-4-3) var(--size-4-4);
		border-radius: var(--code-radius);
		background-color: var(--background-primary);
		color: var(--code-normal);
		font-family: var(--font-monospace);
		font-size: var(--code-size);
		line-height: var(--line-height-normal);
		white-space: pre;
		tab-size: 4;
		user-select: text;
	}

	.qa-import-file-code:focus-visible {
		outline: 2px solid var(--background-modifier-border-focus);
		outline-offset: -2px;
	}

	@media (prefers-reduced-motion: reduce) {
		.qa-import-file-chevron,
		.qa-import-file-preview-wrap {
			transition: none;
		}
	}
</style>
