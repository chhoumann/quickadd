<script lang="ts">
	import type { App } from "obsidian";
	import { Notice } from "obsidian";
	import { settingsStore } from "../../settingsStore";
	import { normalizeTemplateFolderPaths } from "../../utilityObsidian";
	import type {
		LoadedQuickAddPackage,
		PackageAnalysis,
		ChoiceImportMode,
		AssetImportMode,
	} from "../../services/packageImportService";
	import {
		analysePackage,
		analysePackagePreview,
		applyPackageImport,
		parseQuickAddPackage,
	} from "../../services/packageImportService";
	import type { PackagePreview } from "../../services/packagePreview";
	import {
		isFullyReviewed,
		requiresAcknowledgement,
	} from "../../services/packagePreview";
	import CapabilityBanner from "./CapabilityBanner.svelte";
	import FilePreviewRow from "./FilePreviewRow.svelte";
	import ImportAcknowledgement from "./ImportAcknowledgement.svelte";
	import ImportChoices from "./ImportChoices.svelte";
	import PackageWarnings from "./PackageWarnings.svelte";
	import ObsidianIcon from "../components/ObsidianIcon.svelte";
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

	let { app, close }: { app: App; close: () => void } = $props();

	// Lazily memoized so the `app` prop is read inside a closure (not captured at
	// the top level) and so the monotonic token survives every re-paste.
	let existenceResolver: ExistenceResolver | undefined;
	function existence(): ExistenceResolver {
		return (existenceResolver ??= new ExistenceResolver(app));
	}

	let loadedPackage = $state<LoadedQuickAddPackage | null>(null);
	let analysis = $state<PackageAnalysis | null>(null);
	let preview = $state<PackagePreview | null>(null);
	let acknowledged = $state(false);
	let reviewedScriptPaths = $state(new Set<string>());
	let expandedMacros = $state(new Set<string>());
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
	let pastedContent = $state("");
	let isAnalyzing = $state(false);
	let analysisToken = $state(0);
	let hasImported = $state(false);

	const requiresAck = $derived(
		preview ? requiresAcknowledgement(preview) : false,
	);
	const fullyReviewed = $derived(
		preview ? isFullyReviewed(preview, reviewedScriptPaths) : true,
	);
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
	const canImport = $derived(
		Boolean(loadedPackage && analysis) &&
			// A re-paste keeps the previous package live until its analysis
			// resolves; block Import in that window so a stale package can't be
			// written while new content is being analysed.
			!isAnalyzing &&
			(!requiresAck || (acknowledged && fullyReviewed)),
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

	const optimisticExists: ExistsProbe = (path) =>
		existence().optimistic(path);

	const fileRows = $derived(
		(analysis?.assetConflicts ?? []).map((conflict) => ({
			conflict,
			state: resolveAssetDecision(
				assetDecisions,
				conflict,
				defaultAssetDestination,
				optimisticExists,
			),
			file: previewFileByPath.get(conflict.originalPath),
		})),
	);
	const addedFileRows = $derived(
		fileRows.filter((row) => !row.state.destinationExists),
	);
	const overwriteFileRows = $derived(
		fileRows.filter((row) => row.state.destinationExists),
	);

	function defaultAssetDestination(conflict: AssetConflict): string {
		// Default imported templates into the first configured template folder.
		// normalizeTemplateFolderPaths drops blanks and trailing slashes, so the
		// primary entry is already a clean folder path.
		const [templateFolder] = normalizeTemplateFolderPaths(
			settingsStore.getState().templateFolderPaths,
		);
		const needsTemplateFolder =
			conflict.kind === "template" ||
			conflict.kind === "capture-template";

		if (templateFolder && needsTemplateFolder) {
			const baseName =
				conflict.originalPath.split("/").pop() ?? conflict.originalPath;
			return `${templateFolder}/${baseName}`;
		}

		return conflict.originalPath;
	}

	// Reconcile a destination against the authoritative adapter.exists (which sees
	// config/dot-folder files the vault index omits) and correct the stored
	// decision when it differs.
	function scheduleExists(originalPath: string, effectivePath: string) {
		existence().schedule(originalPath, effectivePath, (exists) => {
			assetDecisions = applyExistsResult(
				assetDecisions,
				originalPath,
				exists,
			);
		});
	}

	function initialiseDecisions() {
		if (!analysis) {
			choiceDecisions = new Map();
			assetDecisions = new Map();
			return;
		}
		choiceDecisions = initChoiceDecisions(analysis.choiceConflicts);
		assetDecisions = initAssetDecisions(
			analysis.assetConflicts,
			defaultAssetDestination,
			optimisticExists,
		);
		for (const conflict of analysis.assetConflicts) {
			const decision = assetDecisions.get(conflict.originalPath);
			if (decision)
				scheduleExists(conflict.originalPath, decision.destinationPath);
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
		expandedMacros = new Set();
	}

	async function analyzePastedContent(raw: string) {
		const trimmed = raw.trim();
		const token = ++analysisToken;
		importSummary = null;
		hasImported = false;
		if (!trimmed) {
			loadedPackage = null;
			analysis = null;
			choiceDecisions = new Map();
			assetDecisions = new Map();
			resetPreviewState();
			loadError = null;
			return;
		}

		isAnalyzing = true;
		try {
			const pkg = parseQuickAddPackage(trimmed);
			const existingChoices = settingsStore.getState().choices;
			const analysisResult = await analysePackage(
				app,
				existingChoices,
				pkg,
			);
			const previewResult = await analysePackagePreview(
				app,
				existingChoices,
				pkg,
			);

			if (token !== analysisToken) return;

			loadedPackage = { pkg, path: "[pasted]" };
			analysis = analysisResult;
			resetPreviewState();
			preview = previewResult;
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

	function handleContentInput(event: Event) {
		const value = (event.currentTarget as HTMLTextAreaElement).value;
		pastedContent = value;
		void analyzePastedContent(value);
	}


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
			const result = await applyPackageImport({
				app,
				existingChoices: settingsStore.getState().choices,
				aiProviders: settingsStore.getState().ai.providers,
				pkg: loadedPackage.pkg,
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

			settingsStore.setState((state) => ({
				...state,
				choices: result.updatedChoices,
			}));

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
	}
</script>

<div class="importPackageModal">
	<header>
		<h2>Import QuickAdd package</h2>
		<p>Review what this package adds and runs before importing.</p>
	</header>

	<section class="pasteSection">
		<label>
			<span>Paste package JSON</span>
			<textarea
				bind:value={pastedContent}
				oninput={handleContentInput}
				placeholder="Paste the contents of a .quickadd.json package here"
				rows="8"
			></textarea>
		</label>
		{#if loadError}
			<div class="errorMessage">{loadError}</div>
		{:else if isAnalyzing}
			<div class="info">Analyzing package…</div>
		{/if}
	</section>

	{#if loadedPackage && analysis}
		<section class="packageMeta">
			<span
				><span class="metaLabel">Version</span>
				{loadedPackage.pkg.quickAddVersion}</span
			>
			<span class="metaSep" aria-hidden="true">·</span>
			<span
				><span class="metaLabel">Created</span>
				{new Date(
					loadedPackage.pkg.createdAt,
				).toLocaleDateString()}</span
			>
			<span class="metaSep" aria-hidden="true">·</span>
			<span
				>{analysis.choiceConflicts.length} choice{analysis
					.choiceConflicts.length === 1
					? ""
					: "s"}</span
			>
			<span class="metaSep" aria-hidden="true">·</span>
			<span
				>{loadedPackage.pkg.assets.length} file{loadedPackage.pkg.assets
					.length === 1
					? ""
					: "s"}</span
			>
		</section>

		{#if showBanner && preview}
			<CapabilityBanner {preview} />
		{/if}

		<ImportChoices conflicts={analysis.choiceConflicts} {choiceDecisions}
			{previewChoiceById} {expandedMacros} {toggleMacro} {onChoiceModeChange} />

		{#if loadedPackage}
			<section class="filesSection">
				<h3>Files</h3>
				{#if fileRows.length === 0}
					<p>No files bundled with this package.</p>
				{:else}
					{#each [
						{ label: "Added", rows: addedFileRows, overwrite: false },
						{ label: "Will overwrite", rows: overwriteFileRows, overwrite: true },
					] as group (group.label)}
						{#if group.rows.length > 0}
							<h4 class="filesGroupHeading" class:overwrite={group.overwrite}>
								{group.label} ({group.rows.length})
							</h4>
						<div class="fileRows">
							{#each group.rows as row (row.conflict.originalPath)}
								{#if row.file}
									<FilePreviewRow
										file={row.file}
										pkg={loadedPackage.pkg}
										mode={row.state.mode}
										destinationPath={row.state
											.destinationPath}
										destinationExists={row.state
											.destinationExists}
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
						</div>
						{/if}
					{/each}
				{/if}
			</section>

			<PackageWarnings {preview} />
		{/if}

		{#if importSummary}
			<section class="summary">
				<ObsidianIcon iconId="check-circle" size={16} />
				<span>{importSummaryText}</span>
			</section>
		{/if}
	{/if}

	{#if loadedPackage && requiresAck && !hasImported}
		<ImportAcknowledgement {preview} {fullyReviewed} bind:acknowledged />
	{/if}

	<section class="footer">
		<button
			type="button"
			onclick={close}
			class="secondary"
			disabled={isImporting}
		>
			Cancel
		</button>
		<button
			type="button"
			onclick={hasImported ? close : handleImport}
			class="primary"
			disabled={isImporting || (!hasImported && !canImport)}
			title={!hasImported && requiresAck && fullyReviewed && !acknowledged
				? "Confirm the acknowledgement above to continue"
				: undefined}
		>
			{#if isImporting}
				Importing…
			{:else if hasImported}
				Close
			{:else}
				Import package
			{/if}
		</button>
	</section>
</div>

<style>
	.importPackageModal {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		width: min(720px, 100%);
		max-height: 80vh;
		overflow-y: auto;
		/* overflow-x:hidden (paired with overflow-y:auto) clips child focus rings
		   at the flush left/right edges; the inline padding gives the ring room. */
		overflow-x: hidden;
		box-sizing: border-box;
		padding: 2px 4px;
	}

	.importPackageModal * {
		box-sizing: border-box;
	}

	.importPackageModal > section {
		max-width: 100%;
	}

	.pasteSection label {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.pasteSection textarea {
		width: 100%;
		font-family: var(--font-monospace);
		resize: vertical;
	}

	.errorMessage {
		color: var(--text-error);
	}

	.info {
		color: var(--text-muted);
	}

	/* A single compact line that sizes to content and wraps naturally, instead
	   of a 4-equal-column grid where the date wraps to 3 lines and the rest
	   leave dead space. */
	.packageMeta {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.3rem 0.6rem;
		padding: 0.55rem 0.75rem;
		border: 1px solid var(--background-modifier-border);
		border-radius: var(--radius-m, 8px);
		width: 100%;
		font-size: var(--font-ui-small, 0.9rem);
		overflow-wrap: anywhere;
	}

	.metaLabel {
		color: var(--text-muted);
	}

	.metaSep {
		color: var(--text-faint);
	}

	.filesSection {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.filesGroupHeading {
		margin: 0;
		font-size: var(--font-ui-small, 0.9rem);
		font-weight: 600;
		color: var(--text-muted);
	}

	.filesGroupHeading.overwrite {
		color: var(--text-error);
	}

	.fileRows {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.summary {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.55rem 0.7rem;
		border-radius: var(--radius-m, 8px);
		border: 1px solid var(--qa-sev-success-border);
		background: var(--qa-sev-success-wash);
		color: var(--text-normal);
	}

	.summary :global(.quickadd-icon) {
		color: var(--text-success, var(--color-green, #0aa344));
		flex-shrink: 0;
	}

	.footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	.footer .primary {
		background: var(--interactive-accent);
		color: var(--text-on-accent);
	}

	.footer .primary:hover:not(:disabled) {
		background: var(--interactive-accent-hover);
	}

	.footer .primary:active:not(:disabled),
	.footer .secondary:active:not(:disabled) {
		transform: translateY(1px);
	}

	.footer .secondary {
		background: transparent;
	}

	.footer .secondary:hover:not(:disabled) {
		background: var(--background-modifier-hover);
	}

	.footer .secondary:focus-visible {
		outline: 2px solid var(--interactive-accent);
		outline-offset: 2px;
	}

	/* Accent background needs a light outline to stay visible. */
	.footer .primary:focus-visible {
		outline: 2px solid var(--text-on-accent);
		outline-offset: -4px;
	}

	@media (prefers-reduced-motion: reduce) {
		.footer .primary,
		.footer .secondary {
			transition: none;
		}

		.footer .primary:active:not(:disabled),
		.footer .secondary:active:not(:disabled) {
			transform: none;
		}
	}
</style>
