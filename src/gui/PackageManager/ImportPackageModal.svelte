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
	import MacroDisclosure from "./MacroDisclosure.svelte";
	import ObsidianIcon from "../components/ObsidianIcon.svelte";
	import {
		ExistenceResolver,
		applyExistsResult,
		effectiveChoiceMode,
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

	const criticalScriptCount = $derived(
		preview?.criticalScriptPaths.length ?? 0,
	);
	const hasUnbundledScript = $derived(
		preview?.missingReferences.some((ref) => ref.asScript) ?? false,
	);
	// The checkbox only claims a script review when there are bundled scripts to
	// open; otherwise the copy stays honest about why no code is shown.
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

	const ackLabel = $derived(
		criticalScriptCount > 0
			? hasUnbundledScript
				? "I have reviewed each bundled script above and trust the source, including scripts that are not included and cannot be shown."
				: "I have reviewed each script above and trust the source."
			: hasUnbundledScript
				? "This package runs scripts that are not included and cannot be reviewed. I trust the source."
				: "I understand this package can run code, and I trust the source.",
	);

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

	function formatPathHint(pathHint: string[]): string {
		if (!pathHint || pathHint.length === 0) return "Root";
		return pathHint.slice(0, -1).join(" › ") || "Root";
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
		<h2>Import QuickAdd Package</h2>
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

		<section class="choicesSection">
			<h3>Choices</h3>
			{#if analysis.choiceConflicts.length === 0}
				<p>No choices found in this package.</p>
			{:else}
				<table>
					<colgroup>
						<col class="colName" />
						<col class="colLocation" />
						<col class="colAction" />
					</colgroup>
					<thead>
						<tr>
							<th>Name</th>
							<th>Location</th>
							<th>Action</th>
						</tr>
					</thead>
					<tbody>
						{#each analysis.choiceConflicts as conflict (conflict.choiceId)}
							{@const effectiveMode = effectiveChoiceMode(
								choiceDecisions.get(conflict.choiceId) ??
									"import",
								conflict.exists,
							)}
							{@const pc = previewChoiceById.get(
								conflict.choiceId,
							)}
							{@const hasMacro = (pc?.commands?.length ?? 0) > 0}
							<tr>
								<td data-label="Name">
									<div class="choiceName">
										{conflict.name}
									</div>
									{#if conflict.exists}
										<div class="choiceExists">
											already in vault
										</div>
									{/if}
									{#if hasMacro}
										<button
											type="button"
											class="macroToggle"
											aria-expanded={expandedMacros.has(
												conflict.choiceId,
											)}
											onclick={() =>
												toggleMacro(conflict.choiceId)}
										>
											{expandedMacros.has(
												conflict.choiceId,
											)
												? "Hide macro"
												: "Show macro"}
										</button>
									{/if}
								</td>
								<td data-label="Location"
									>{formatPathHint(conflict.pathHint)}</td
								>
								<td data-label="Action">
									<select
										class="dropdown"
										value={effectiveMode}
										onchange={(event) =>
											onChoiceModeChange(
												conflict.choiceId,
												event,
											)}
									>
										<option value="import">Import</option>
										{#if conflict.exists}
											<option value="overwrite"
												>Overwrite</option
											>
										{/if}
										<option value="duplicate"
											>Duplicate</option
										>
										<option value="skip">Skip</option>
									</select>
								</td>
							</tr>
							{#if hasMacro && expandedMacros.has(conflict.choiceId)}
								<tr class="macroRow">
									<td colspan="3">
										<MacroDisclosure
											commands={pc?.commands ?? []}
										/>
									</td>
								</tr>
							{/if}
						{/each}
					</tbody>
				</table>
			{/if}
		</section>

		{#if loadedPackage}
			<section class="filesSection">
				<h3>Files</h3>
				{#if fileRows.length === 0}
					<p>No files bundled with this package.</p>
				{:else}
					{#if addedFileRows.length > 0}
						<h4 class="filesGroupHeading">
							Added ({addedFileRows.length})
						</h4>
						<div class="fileRows">
							{#each addedFileRows as row (row.conflict.originalPath)}
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
					{#if overwriteFileRows.length > 0}
						<h4 class="filesGroupHeading overwrite">
							Will overwrite ({overwriteFileRows.length})
						</h4>
						<div class="fileRows">
							{#each overwriteFileRows as row (row.conflict.originalPath)}
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
				{/if}
			</section>

			{#if preview && (preview.missingReferences.length > 0 || preview.orphanAssets.length > 0)}
				<section class="warningsBand">
					{#if preview.missingReferences.length > 0}
						<div class="warnItem">
							<h4>Missing files</h4>
							<ul>
								{#each preview.missingReferences as ref (ref.path)}
									<li class:script={ref.asScript}>
										<code>{ref.path}</code>:
										{ref.asScript
											? "not bundled, so it runs from whatever file exists at that path after import"
											: "not bundled and not in your vault"}
										<span class="warnLoc"
											>{ref.breadcrumb}</span
										>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
					{#if preview.orphanAssets.length > 0}
						<div class="warnItem">
							<h4>Unreferenced files</h4>
							<ul>
								{#each preview.orphanAssets as path (path)}
									<li>
										<code>{path}</code>: bundled but not
										used by any choice
									</li>
								{/each}
							</ul>
						</div>
					{/if}
				</section>
			{/if}
		{/if}

		{#if importSummary}
			<section class="summary">
				<ObsidianIcon iconId="check-circle" size={16} />
				<span>{importSummaryText}</span>
			</section>
		{/if}
	{/if}

	{#if loadedPackage && requiresAck && !hasImported}
		<section class="ackGate" class:critical={preview?.summary.hasCritical}>
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

	.choicesSection,
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

	.choiceName {
		font-weight: 500;
	}

	/* A plain inline text link, not a chrome button: neutralise Obsidian's
	   default button background/shadow on every state (!important to win over
	   the global button:hover / :focus rules that paint the grey box). */
	.macroToggle {
		display: inline-block;
		margin-top: 0.35rem;
		padding: 0;
		background: transparent !important;
		border: none;
		box-shadow: none !important;
		color: var(--text-accent);
		cursor: pointer;
		font-size: var(--font-ui-smaller, 0.8rem);
		border-radius: var(--radius-s, 4px);
	}

	.macroToggle:hover {
		color: var(--interactive-accent-hover, var(--text-accent));
		text-decoration: underline;
	}

	.macroToggle:focus-visible {
		outline: 2px solid var(--interactive-accent);
		outline-offset: 2px;
	}

	.macroRow td {
		background: var(--background-primary-alt, var(--background-secondary));
	}

	.warningsBand {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--background-modifier-border);
		border-radius: var(--radius-m, 8px);
		padding: 0.6rem 0.75rem;
		gap: 0.5rem;
	}

	.warnItem h4 {
		margin: 0;
		font-size: var(--font-ui-small, 0.9rem);
	}

	.warnItem ul {
		margin: 0.25rem 0 0;
		padding-left: 1rem;
	}

	.warnItem li {
		overflow-wrap: anywhere;
	}

	/* A missing SCRIPT reference is an execution-hijack risk, not a broken
	   link: it runs from whatever exists at that path. Mark it as critical. */
	.warnItem li.script {
		padding: 0.25rem 0.4rem;
		border-radius: var(--radius-s, 4px);
		background: var(--qa-sev-critical-wash);
	}

	.warnLoc {
		color: var(--text-muted);
		font-size: var(--font-ui-smaller, 0.8rem);
	}

	.choicesSection table {
		width: 100%;
		border-collapse: collapse;
		table-layout: fixed;
	}

	.choicesSection col.colName {
		width: 52%;
	}

	.choicesSection col.colLocation {
		width: 26%;
	}

	.choicesSection col.colAction {
		width: 22%;
	}

	.choicesSection th,
	.choicesSection td {
		padding: 0.5rem;
		border-bottom: 1px solid var(--background-modifier-border);
		text-align: left;
		word-break: break-word;
		overflow-wrap: anywhere;
		white-space: normal;
		vertical-align: top;
	}

	.choicesSection th {
		font-size: var(--font-ui-smaller, 0.8rem);
		color: var(--text-muted);
		font-weight: 600;
	}

	.choiceExists {
		font-size: var(--font-ui-smaller, 0.8rem);
		color: var(--text-muted);
		margin-top: 0.1rem;
	}

	.choicesSection tbody tr:not(.macroRow):hover td {
		background: var(--background-modifier-hover);
	}

	.choicesSection select {
		max-width: 100%;
	}

	/* Narrow viewports (mobile): a 3-column table can't breathe, so each row
	   becomes a stacked card with the column name as an inline label. */
	@media (max-width: 500px) {
		.choicesSection thead {
			display: none;
		}

		.choicesSection table,
		.choicesSection tbody,
		.choicesSection tr,
		.choicesSection td {
			display: block;
			width: 100%;
		}

		.choicesSection tbody tr:not(.macroRow) {
			border: 1px solid var(--background-modifier-border);
			border-radius: var(--radius-m, 8px);
			padding: 0.5rem 0.6rem;
			margin-bottom: 0.5rem;
		}

		.choicesSection td {
			border-bottom: none;
			padding: 0.15rem 0;
		}

		.choicesSection td[data-label="Location"]::before,
		.choicesSection td[data-label="Action"]::before {
			content: attr(data-label) ": ";
			font-weight: 600;
			color: var(--text-muted);
		}

		.choicesSection td[data-label="Action"] {
			display: flex;
			align-items: center;
			gap: 0.4rem;
			margin-top: 0.25rem;
		}

		.choicesSection td[data-label="Action"] select {
			flex: 1;
		}

		.macroRow td {
			padding: 0.25rem 0;
		}
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

	:global(.is-mobile) .macroToggle {
		min-height: 36px;
		padding: 0.4rem 0.3rem;
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
