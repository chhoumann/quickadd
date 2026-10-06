<script lang="ts">
	import type { App } from "obsidian";
	import { Notice } from "obsidian";
	import { type Snippet, tick, untrack } from "svelte";
	import type IChoice from "../../types/choices/IChoice";
	import type { QuickAddPackage } from "../../types/packages/QuickAddPackage";
	import type {
		ApplyImportResult,
		PackageAnalysis,
		ChoiceImportMode,
		AssetImportMode,
	} from "../../services/packageImportService";
	import type { PackagePreview } from "../../services/packagePreview";
	import {
		requiresAcknowledgement,
		unreviewedScriptCount,
	} from "../../services/packagePreview";
	import CapabilityBanner from "./CapabilityBanner.svelte";
	import FilePreviewRow from "./FilePreviewRow.svelte";
	import ImportAcknowledgement from "./ImportAcknowledgement.svelte";
	import ImportChoices from "./ImportChoices.svelte";
	import PackageWarnings from "./PackageWarnings.svelte";
	import ObsidianIcon from "../components/ObsidianIcon.svelte";
	import { analyseForImport, defaultAssetDestination, importPackage } from "./packageImport";
	import {
		ExistenceResolver,
		applyExistsResult,
		initAssetDecisions,
		initChoiceDecisions,
		resolveAssetDecision,
		setAssetMode,
		setAssetPath,
		setChoiceMode,
		snapshotAssetDecisions,
		snapshotChoiceDecisions,
	} from "./importDecisions";
	import type {
		AssetConflict,
		AssetDecisions,
		ChoiceDecisions,
		ExistsProbe,
	} from "./importDecisions";

	/**
	 * The review a package gets before it is imported: what it can do, its
	 * choices and files with a decision for each, and the acknowledgement for
	 * code. Shared by the paste importer and the Recipes gallery.
	 */
	let {
		app,
		pkg,
		importLabel,
		cancelLabel = "Cancel",
		showDetails = false,
		onCancel,
		onDone,
		onImported,
		header,
		keepExistingFiles = false,
	}: {
		app: App;
		/** The package to review; null while there is none. */
		pkg: QuickAddPackage | null;
		importLabel: string;
		cancelLabel?: string;
		/** Say the package's version, date and size above the review. */
		showDetails?: boolean;
		onCancel: () => void;
		/** The footer's only button once the import is done. */
		onDone: () => void;
		/** Called after a successful import with the choices as they were before it. */
		onImported?: (result: ApplyImportResult, previousChoices: IChoice[]) => void;
		/** Rendered at the top of the scrolling body. */
		header?: Snippet;
		/** A file already in the vault is kept unless the reader chooses otherwise. */
		keepExistingFiles?: boolean;
	} = $props();

	// Lazily memoized so the `app` prop is read inside a closure (not captured at
	// the top level) and so the monotonic token survives every re-paste.
	let existenceResolver: ExistenceResolver | undefined;
	function existence(): ExistenceResolver {
		return (existenceResolver ??= new ExistenceResolver(app));
	}

	let loadedPackage = $state<QuickAddPackage | null>(null);
	let analysis = $state<PackageAnalysis | null>(null);
	let preview = $state<PackagePreview | null>(null);
	let acknowledged = $state(false);
	let reviewedScriptPaths = $state(new Set<string>());
	let reviewedChoiceIds = $state(new Set<string>());
	let expandedMacros = $state(new Set<string>());
	let expandedCode = $state(new Set<string>());
	let loadError = $state<string | null>(null);
	let isImporting = $state(false);
	let importSummary = $state<{
		added: number;
		overwritten: number;
		skipped: number;
		assetsWritten: number;
		assetsSkipped: number;
	} | null>(null);

	let choiceDecisions = $state<ChoiceDecisions>(new Map());
	let assetDecisions = $state<AssetDecisions>(new Map());
	// Files that will overwrite, as found when the package was analysed. Rows are
	// grouped by this, not by the live destination, so a row never jumps groups
	// (and loses focus) while you type its path; the row itself shows the live state.
	let overwritesAtLoad = $state(new Set<string>());
	let isAnalyzing = $state(false);
	let analysisToken = $state(0);
	let hasImported = $state(false);
	let importSummaryEl = $state<HTMLElement | null>(null);

	const requiresAck = $derived(
		preview ? requiresAcknowledgement(preview) : false,
	);
	const unreviewedCount = $derived(
		preview
			? unreviewedScriptCount(preview, reviewedScriptPaths, reviewedChoiceIds)
			: 0,
	);
	const fullyReviewed = $derived(unreviewedCount === 0);
	const previewChoiceById = $derived(
		new Map(
			(preview?.choices ?? []).map((choice) => [choice.choiceId, choice]),
		),
	);
	const previewFileByPath = $derived(
		new Map(
			(preview?.files ?? []).map((file) => [file.originalPath, file]),
		),
	);
	const showBanner = $derived(
		Boolean(
			preview &&
			(preview.summary.hasCritical || preview.summary.hasWarning),
		),
	);
	const importSummaryText = $derived.by(() => {
		const s = importSummary;
		if (!s) return "";
		const parts: string[] = [];
		if (s.added)
			parts.push(`${s.added} choice${s.added === 1 ? "" : "s"} added`);
		if (s.overwritten) parts.push(`${s.overwritten} overwritten`);
		if (s.assetsWritten)
			parts.push(
				`${s.assetsWritten} file${s.assetsWritten === 1 ? "" : "s"} written`,
			);
		const skipped = s.skipped + s.assetsSkipped;
		if (skipped) parts.push(`${skipped} skipped`);
		return parts.length
			? `Imported: ${parts.join(", ")}.`
			: "Nothing was imported.";
	});


	function markReviewed(path: string) {
		if (reviewedScriptPaths.has(path)) return;
		const next = new Set(reviewedScriptPaths);
		next.add(path);
		reviewedScriptPaths = next;
	}

	function toggleMacro(choiceId: string) {
		const next = new Set(expandedMacros);
		if (next.has(choiceId)) next.delete(choiceId);
		else next.add(choiceId);
		expandedMacros = next;
	}

	function toggleCode(choiceId: string) {
		const next = new Set(expandedCode);
		if (next.has(choiceId)) next.delete(choiceId);
		else next.add(choiceId);
		expandedCode = next;
		if (next.has(choiceId) && !reviewedChoiceIds.has(choiceId))
			reviewedChoiceIds = new Set(reviewedChoiceIds).add(choiceId);
	}

	const optimisticExists: ExistsProbe = (path) =>
		existence().optimistic(path);

	const fileRows = $derived(
		(analysis?.assetConflicts ?? []).map((conflict) => {
			const state = resolveAssetDecision(
				assetDecisions,
				conflict,
				defaultAssetDestination,
				optimisticExists,
				{ keepExisting: keepExistingFiles },
			);
			return {
				conflict,
				state,
				destinationIsFolder:
					state.mode !== "skip" &&
					existence().isFolder(state.destinationPath),
				file: previewFileByPath.get(conflict.originalPath),
			};
		}),
	);
	const addedFileRows = $derived(
		fileRows.filter((row) => !overwritesAtLoad.has(row.conflict.originalPath)),
	);
	const overwriteFileRows = $derived(
		fileRows.filter((row) => overwritesAtLoad.has(row.conflict.originalPath)),
	);

	const canImport = $derived(
		Boolean(loadedPackage && analysis) &&
			// A re-paste keeps the previous package live until its analysis
			// resolves; block Import in that window so a stale package can't be
			// written while new content is being analysed.
			!isAnalyzing &&
			!fileRows.some((row) => row.destinationIsFolder) &&
			(!requiresAck || (acknowledged && fullyReviewed)),
	);

	// Said beside the button, since what blocks it is usually scrolled out of view.
	const blockedReason = $derived.by(() => {
		if (!loadedPackage || !analysis || isAnalyzing || hasImported) return "";
		// Named after the button it sits beside: "Import package" or "Add recipe".
		const verb = importLabel.split(" ")[0]?.toLowerCase() ?? "import";
		if (requiresAck && !fullyReviewed)
			return `View ${unreviewedCount} script${unreviewedCount === 1 ? "" : "s"} above to ${verb}.`;
		if (requiresAck && !acknowledged)
			return `Confirm the acknowledgement above to ${verb}.`;
		if (fileRows.some((row) => row.destinationIsFolder))
			return `A destination above is a folder. Add a file name to ${verb}.`;
		return "";
	});

	// Reconcile a destination against the authoritative adapter.exists (which sees
	// config/dot-folder files the vault index omits) and correct the stored
	// decision when it differs.
	function scheduleExists(
		originalPath: string,
		effectivePath: string,
		regroup = false,
	) {
		existence().schedule(originalPath, effectivePath, (exists) => {
			assetDecisions = applyExistsResult(
				assetDecisions,
				originalPath,
				exists,
				{ keepExisting: keepExistingFiles },
			);
			if (regroup && exists !== overwritesAtLoad.has(originalPath)) {
				const next = new Set(overwritesAtLoad);
				if (exists) next.add(originalPath);
				else next.delete(originalPath);
				overwritesAtLoad = next;
			}
		});
	}

	function initialiseDecisions() {
		if (!analysis) {
			choiceDecisions = new Map();
			assetDecisions = new Map();
			overwritesAtLoad = new Set();
			return;
		}
		choiceDecisions = initChoiceDecisions(analysis.choiceConflicts);
		assetDecisions = initAssetDecisions(
			analysis.assetConflicts,
			defaultAssetDestination,
			optimisticExists,
			{ keepExisting: keepExistingFiles },
		);
		overwritesAtLoad = new Set(
			analysis.assetConflicts
				.filter(
					(conflict) =>
						assetDecisions.get(conflict.originalPath)?.destinationExists,
				)
				.map((conflict) => conflict.originalPath),
		);
		for (const conflict of analysis.assetConflicts) {
			const decision = assetDecisions.get(conflict.originalPath);
			if (decision)
				scheduleExists(
					conflict.originalPath,
					decision.destinationPath,
					true,
				);
		}
	}

	function updateChoiceDecision(choiceId: string, mode: ChoiceImportMode) {
		choiceDecisions = setChoiceMode(choiceDecisions, choiceId, mode);
	}

	function updateAssetMode(originalPath: string, mode: AssetImportMode) {
		assetDecisions = setAssetMode(
			assetDecisions,
			originalPath,
			mode,
			optimisticExists,
		);
	}

	function updateAssetPath(conflict: AssetConflict, value: string) {
		const { decisions, effectivePath } = setAssetPath(
			assetDecisions,
			conflict.originalPath,
			value,
			optimisticExists,
		);
		assetDecisions = decisions;
		scheduleExists(conflict.originalPath, effectivePath);
	}

	function onChoiceModeChange(choiceId: string, event: Event) {
		const element = event.currentTarget as HTMLSelectElement;
		const mode = element.value as ChoiceImportMode;
		updateChoiceDecision(choiceId, mode);
	}

	function resetPreviewState() {
		preview = null;
		acknowledged = false;
		reviewedScriptPaths = new Set();
		reviewedChoiceIds = new Set();
		expandedMacros = new Set();
		expandedCode = new Set();
	}

	async function analyze(next: QuickAddPackage | null) {
		const token = ++analysisToken;
		importSummary = null;
		hasImported = false;
		if (!next) {
			loadedPackage = null;
			analysis = null;
			choiceDecisions = new Map();
			assetDecisions = new Map();
			resetPreviewState();
			loadError = null;
			isAnalyzing = false;
			return;
		}

		isAnalyzing = true;
		try {
			const result = await analyseForImport(app, next);

			if (token !== analysisToken) return;

			loadedPackage = next;
			analysis = result.analysis;
			resetPreviewState();
			preview = result.preview;
			loadError = null;
			initialiseDecisions();
		} catch (error) {
			if (token !== analysisToken) return;
			loadError = (error as Error)?.message ?? String(error);
			loadedPackage = null;
			analysis = null;
			choiceDecisions = new Map();
			assetDecisions = new Map();
			resetPreviewState();
		} finally {
			if (token === analysisToken) {
				isAnalyzing = false;
			}
		}
	}

	// Each new package is analysed afresh; until that resolves the previous one
	// stays on screen, with Import blocked.
	$effect(() => {
		const next = pkg;
		untrack(() => void analyze(next));
	});

	async function handleImport() {
		if (hasImported) {
			new Notice("This package has already been imported.");
			return;
		}

		if (!loadedPackage || !analysis) {
			new Notice("Load a package before importing.");
			return;
		}

		isImporting = true;
		importSummary = null;
		try {
			const { result, previousChoices } = await importPackage({
				app,
				pkg: loadedPackage,
				choiceDecisions: snapshotChoiceDecisions(
					analysis.choiceConflicts,
					choiceDecisions,
				),
				assetDecisions: snapshotAssetDecisions(
					analysis.assetConflicts,
					assetDecisions,
					optimisticExists,
				),
			});
			onImported?.(result, previousChoices);

			importSummary = {
				added: result.addedChoiceIds.length,
				overwritten: result.overwrittenChoiceIds.length,
				skipped: result.skippedChoiceIds.length,
				assetsWritten: result.writtenAssets.length,
				assetsSkipped: result.skippedAssets.length,
			};
			hasImported = true;

			new Notice(
				`Imported ${result.addedChoiceIds.length + result.overwrittenChoiceIds.length} choice${
					result.addedChoiceIds.length +
						result.overwrittenChoiceIds.length ===
					1
						? ""
						: "s"
				} successfully.`,
			);
		} catch (error) {
			console.error(error);
			new Notice(`Import failed: ${(error as Error)?.message ?? error}`);
		} finally {
			isImporting = false;
		}

		if (!hasImported) return;
		// The result renders at the end of the scrolling body, below the review
		// you just finished; bring it into view above the footer.
		await tick();
		importSummaryEl?.scrollIntoView({ block: "nearest" });
	}
</script>

<div class="qa-package-dialog">
	<div class="qa-package-body">
		{@render header?.()}
		{#if loadError}
			<p class="qa-import-status mod-error">{loadError}</p>
		{:else if isAnalyzing}
			<p class="qa-import-status">Analyzing package…</p>
		{:else if showDetails && loadedPackage && analysis}
			<p class="qa-import-status">
				Version {loadedPackage.quickAddVersion} · Created {new Date(
					loadedPackage.createdAt,
				).toLocaleDateString()} · {analysis.choiceConflicts.length} choice{analysis
					.choiceConflicts.length === 1
					? ""
					: "s"} · {loadedPackage.assets.length} file{loadedPackage
					.assets.length === 1
					? ""
					: "s"}
			</p>
		{/if}

		{#if loadedPackage && analysis}
			{#if showBanner && preview}
				<CapabilityBanner {preview} />
			{/if}

			<ImportChoices conflicts={analysis.choiceConflicts} {choiceDecisions}
				{previewChoiceById} {expandedMacros} {toggleMacro} {expandedCode}
				{reviewedChoiceIds} {toggleCode} {onChoiceModeChange} />

			<section class="setting-group qa-import-files">
				<div class="setting-item setting-item-heading">
					<div class="setting-item-name">Files</div>
				</div>
				{#if fileRows.length === 0}
					<div class="setting-items">
						<div class="setting-item mod-empty-state">
							<div class="setting-item-info">
								<div class="setting-item-name">
									No files bundled with this package.
								</div>
							</div>
						</div>
					</div>
				{:else}
					{#each [
						{ label: "Added", rows: addedFileRows, overwrite: false },
						{ label: "Will overwrite", rows: overwriteFileRows, overwrite: true },
					] as group (group.label)}
						{#if group.rows.length > 0}
							<h4 class="qa-import-files-group" class:mod-warning={group.overwrite}>
								{group.label} ({group.rows.length})
							</h4>
							{#each group.rows as row (row.conflict.originalPath)}
								{#if row.file}
									<FilePreviewRow
										file={row.file}
										pkg={loadedPackage}
										mode={row.state.mode}
										destinationPath={row.state
											.destinationPath}
										destinationExists={row.state
											.destinationExists}
										destinationIsFolder={row.destinationIsFolder}
										onPathInput={(value) =>
											updateAssetPath(
												row.conflict,
												value,
											)}
										onModeChange={(mode) =>
											updateAssetMode(
												row.conflict.originalPath,
												mode,
											)}
										reviewed={reviewedScriptPaths.has(
											row.file.originalPath,
										)}
										onReviewed={markReviewed}
									/>
								{/if}
							{/each}
						{/if}
					{/each}
				{/if}
			</section>

			<PackageWarnings {preview} />

			{#if importSummary}
				<section
					class="callout qa-import-summary"
					data-callout="success"
					role="status"
					bind:this={importSummaryEl}
				>
					<div class="callout-title">
						<div class="callout-icon">
							<ObsidianIcon iconId="check" />
						</div>
						<div class="callout-title-inner">{importSummaryText}</div>
					</div>
				</section>
			{/if}
		{/if}

		{#if loadedPackage && requiresAck && !hasImported}
			<ImportAcknowledgement {preview} {fullyReviewed}
				reasonId={blockedReason ? "qa-import-reason" : undefined}
				bind:acknowledged />
		{/if}
	</div>

	<div class="modal-button-container">
		{#if blockedReason}
			<p id="qa-import-reason" class="qa-import-reason">{blockedReason}</p>
		{/if}
		{#if !hasImported}
			<button type="button" onclick={onCancel} disabled={isImporting}>
				{cancelLabel}
			</button>
		{/if}
		<button
			type="button"
			onclick={hasImported ? onDone : handleImport}
			class="mod-cta"
			disabled={isImporting || (!hasImported && !canImport)}
			aria-describedby={blockedReason ? "qa-import-reason" : undefined}
		>
			{#if isImporting}
				Importing…
			{:else if hasImported}
				Close
			{:else}
				{importLabel}
			{/if}
		</button>
	</div>
</div>

<style>
	.qa-import-status {
		margin: 0;
		font-size: var(--font-ui-smaller);
		color: var(--text-muted);
		overflow-wrap: anywhere;
	}

	.qa-import-status.mod-error {
		color: var(--text-error);
	}

	.qa-import-files {
		display: flex;
		flex-direction: column;
		gap: var(--size-4-3);
	}

	.qa-import-files .setting-item-heading {
		margin-bottom: var(--size-4-1);
	}

	/* Small muted group label, like Obsidian's settings sidebar sections. */
	.qa-import-files-group {
		margin: var(--size-4-2) 0 0;
		padding: 0 var(--size-4-4);
		font-size: var(--font-ui-smaller);
		font-weight: var(--font-semibold);
		color: var(--text-muted);
	}

	.qa-import-files-group:first-of-type {
		margin-top: 0;
	}

	.qa-import-files-group.mod-warning {
		color: var(--text-warning);
	}

	.qa-import-summary {
		margin: 0;
	}

	/* Left of the buttons; the text wraps before they do. */
	.qa-import-reason {
		flex: 1 1 0;
		align-self: center;
		margin: 0;
		font-size: var(--font-ui-smaller);
		color: var(--text-muted);
	}

	/* The phone footer stacks its buttons bottom-up; put the reason on top. */
	:global(.is-phone) .qa-import-reason {
		flex: none;
		order: 1;
		text-align: center;
	}
</style>
