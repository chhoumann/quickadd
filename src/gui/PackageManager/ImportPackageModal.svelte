<script lang="ts">
	import type { App } from "obsidian";
	import { Notice } from "obsidian";
	import { settingsStore } from "../../settingsStore";
	import type {
		LoadedQuickAddPackage,
		PackageAnalysis,
		ChoiceImportDecision,
		AssetImportDecision,
		ChoiceImportMode,
		AssetImportMode,
	} from "../../services/packageImportService";
	import {
		analysePackage,
		applyPackageImport,
		parseQuickAddPackage,
	} from "../../services/packageImportService";

export let app: App;
export let close: () => void;

let loadedPackage: LoadedQuickAddPackage | null = null;
let analysis: PackageAnalysis | null = null;
let loadError: string | null = null;
let isImporting = false;
let importSummary: {
	added: number;
	overwritten: number;
	skipped: number;
	assetsWritten: number;
	assetsSkipped: number;
} | null = null;

let choiceDecisions = new Map<string, ChoiceImportMode>();

type AssetDecisionState = {
	mode: AssetImportMode;
	destinationPath: string;
};

type AssetConflict = PackageAnalysis["assetConflicts"][number];

let assetDecisions = new Map<string, AssetDecisionState>();
let pastedContent = "";
let isAnalyzing = false;
let analysisToken = 0;
let hasImported = false;

function defaultAssetDestination(conflict: AssetConflict): string {
	const templateFolder = settingsStore.getState().templateFolderPath?.trim();
	const needsTemplateFolder =
		conflict.kind === "template" || conflict.kind === "capture-template";

	if (templateFolder && needsTemplateFolder) {
		const baseName =
			conflict.originalPath.split("/").pop() ?? conflict.originalPath;
		const sanitizedFolder = templateFolder.replace(/\/+$/, "");
		return sanitizedFolder ? `${sanitizedFolder}/${baseName}` : baseName;
	}

	return conflict.originalPath;
}

function initialiseDecisions() {
	choiceDecisions = new Map();
	assetDecisions = new Map();
	if (!analysis) return;

	for (const conflict of analysis.choiceConflicts) {
		const defaultMode = conflict.exists ? "overwrite" : "import";
		choiceDecisions.set(conflict.choiceId, defaultMode);
	}

	for (const conflict of analysis.assetConflicts) {
		const defaultMode = conflict.exists ? "overwrite" : "write";
		const defaultDestination = defaultAssetDestination(conflict);
		assetDecisions.set(conflict.originalPath, {
			mode: defaultMode,
			destinationPath: defaultDestination,
		});
	}
}

function updateChoiceDecision(
	choiceId: string,
	mode: ChoiceImportMode,
) {
	const map = new Map(choiceDecisions);
	map.set(choiceId, mode);
	choiceDecisions = map;
}

function updateAssetMode(path: string, mode: AssetImportMode) {
	const previous =
		assetDecisions.get(path) ??
		({
			mode,
			destinationPath: path,
		} as AssetDecisionState);
	const next: AssetDecisionState = { ...previous, mode };
	const map = new Map(assetDecisions);
	map.set(path, next);
	assetDecisions = map;
}

function updateAssetPath(path: string, value: string) {
	const previous =
		assetDecisions.get(path) ??
		({
			mode: "write",
			destinationPath: path,
		} as AssetDecisionState);
	const next: AssetDecisionState = { ...previous, destinationPath: value };
	const map = new Map(assetDecisions);
	map.set(path, next);
	assetDecisions = map;
}

	function onChoiceModeChange(choiceId: string, event: Event) {
		const element = event.currentTarget as HTMLSelectElement;
		const mode = element.value as ChoiceImportMode;
		updateChoiceDecision(choiceId, mode);
	}

function onAssetModeChange(path: string, event: Event) {
	const element = event.currentTarget as HTMLSelectElement;
	const mode = element.value as AssetImportMode;
	updateAssetMode(path, mode);
}

function onAssetPathChange(path: string, event: Event) {
	const value = (event.currentTarget as HTMLInputElement).value;
	updateAssetPath(path, value);
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
			loadError = null;
			return;
		}

		isAnalyzing = true;
		try {
			const pkg = parseQuickAddPackage(trimmed);
			const analysisResult = await analysePackage(
				app,
				settingsStore.getState().choices,
				pkg,
			);

			if (token !== analysisToken) return;

			loadedPackage = { pkg, path: "[pasted]" };
			analysis = analysisResult;
			loadError = null;
			initialiseDecisions();
		} catch (error) {
			if (token !== analysisToken) return;
			loadError = (error as Error)?.message ?? String(error);
			loadedPackage = null;
			analysis = null;
			choiceDecisions = new Map();
			assetDecisions = new Map();
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
			const choiceDecisionsList: ChoiceImportDecision[] = analysis.choiceConflicts.map(
				(conflict) => {
					const rawMode = choiceDecisions.get(conflict.choiceId) ?? "import";
					const mode =
						conflict.exists || rawMode !== "overwrite" ? rawMode : "import";

					return {
						choiceId: conflict.choiceId,
						mode,
					};
				},
			);

			const assetDecisionsList: AssetImportDecision[] =
				analysis.assetConflicts.map((conflict) => {
					const decisionState = assetDecisions.get(conflict.originalPath);
					const mode =
						decisionState?.mode ??
						(conflict.exists ? "overwrite" : "write");
					const destinationPath =
						decisionState?.destinationPath?.trim() ??
						conflict.originalPath;

					return {
						originalPath: conflict.originalPath,
						destinationPath,
						mode,
					};
				});

			const result = await applyPackageImport({
				app,
				existingChoices: settingsStore.getState().choices,
				pkg: loadedPackage.pkg,
				choiceDecisions: choiceDecisionsList,
				assetDecisions: assetDecisionsList,
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
					result.addedChoiceIds.length + result.overwrittenChoiceIds.length === 1 ? "" : "s"
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
		<p>Select a package file, review conflicts, and choose how to import each item.</p>
	</header>

	<section class="pasteSection">
		<label>
			<span>Paste package JSON</span>
			<textarea
				bind:value={pastedContent}
				on:input={handleContentInput}
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
			<div>
				<strong>QuickAdd version:</strong> {loadedPackage.pkg.quickAddVersion}
			</div>
			<div>
				<strong>Created:</strong> {new Date(loadedPackage.pkg.createdAt).toLocaleString()}
			</div>
			<div>
				<strong>Choices:</strong> {analysis.choiceConflicts.length}
			</div>
			<div>
				<strong>Assets:</strong> {loadedPackage.pkg.assets.length}
			</div>
		</section>

		<section class="choicesSection">
			<h3>Choice decisions</h3>
			{#if analysis.choiceConflicts.length === 0}
				<p>No choices found in this package.</p>
			{:else}
				<table>
					<thead>
						<tr>
							<th>Name</th>
							<th>Location</th>
							<th>Existing</th>
							<th>Action</th>
						</tr>
					</thead>
					<tbody>
						{#each analysis.choiceConflicts as conflict}
							{@const storedMode =
								choiceDecisions.get(conflict.choiceId) ?? "import"}
							{@const effectiveMode =
								!conflict.exists && storedMode === "overwrite"
									? "import"
									: storedMode}
							<tr>
								<td>{conflict.name}</td>
								<td>{formatPathHint(conflict.pathHint)}</td>
								<td>{conflict.exists ? "Yes" : "No"}</td>
								<td>
									<select
										value={effectiveMode}
										on:change={(event) =>
											onChoiceModeChange(conflict.choiceId, event)}
									>
										<option value="import">Import</option>
										{#if conflict.exists}
											<option value="overwrite">Overwrite</option>
										{/if}
										<option value="duplicate">Duplicate</option>
										<option value="skip">Skip</option>
									</select>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</section>

	<section class="assetsSection">
		<h3>Asset decisions</h3>
		{#if loadedPackage.pkg.assets.length === 0}
			<p>No additional assets bundled with this package.</p>
		{:else}
			<div class="assetCards">
				{#each analysis.assetConflicts as conflict}
					{@const assetState =
						assetDecisions.get(conflict.originalPath) ??
						{
							mode: conflict.exists ? "overwrite" : "write",
							destinationPath: defaultAssetDestination(conflict),
						}}
					<div class="assetCard">
						<div class="assetHeader">
							<div class="assetTitle">{conflict.originalPath}</div>
							<div class="assetBadges">
								<span class="assetBadge">{conflict.kind}</span>
								<span
									class={`assetBadge ${conflict.exists ? "assetBadge--warning" : "assetBadge--info"}`}
								>
									{conflict.exists ? "Will overwrite" : "New file"}
								</span>
							</div>
						</div>
						<div class="assetFields">
							<label>
								<span>Destination path</span>
								<input
									type="text"
									value={assetState.destinationPath}
									on:input={(event) => onAssetPathChange(conflict.originalPath, event)}
									placeholder="vault/path/to/file"
									disabled={assetState.mode === "skip"}
								/>
							</label>
							<label>
								<span>Action</span>
								<select
									value={assetState.mode}
									on:change={(event) => onAssetModeChange(conflict.originalPath, event)}
								>
									<option value="write">Write</option>
									{#if conflict.exists}
										<option value="overwrite">Overwrite</option>
									{/if}
									<option value="skip">Skip</option>
								</select>
							</label>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

		{#if importSummary}
			<section class="summary">
				<h3>Last import</h3>
				<ul>
					<li>{importSummary.added} added</li>
					<li>{importSummary.overwritten} overwritten</li>
					<li>{importSummary.skipped} skipped</li>
				<li>{importSummary.assetsWritten} assets written</li>
				<li>{importSummary.assetsSkipped} assets skipped</li>
			</ul>
		</section>
	{/if}
	{/if}

	<section class="footer">
		<button type="button" on:click={close} class="secondary" disabled={isImporting}>
			Cancel
		</button>
		<button
			type="button"
			on:click={handleImport}
			class="primary"
			disabled={isImporting || !loadedPackage || !analysis || hasImported}
		>
			{#if isImporting}
				Importing…
			{:else if hasImported}
				Imported
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
		overflow-x: hidden;
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

	.packageMeta {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 0.5rem;
		padding: 0.5rem;
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		width: 100%;
	}

	.packageMeta div {
		overflow-wrap: anywhere;
	}

	.choicesSection,
	.assetsSection {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.assetCards {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.assetCard {
		border: 1px solid var(--background-modifier-border);
		border-radius: 8px;
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		background: var(--background-secondary);
	}

	.assetHeader {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.assetTitle {
		font-weight: 600;
		word-break: break-word;
	}

	.assetBadges {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.assetBadge {
		display: inline-flex;
		align-items: center;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		font-size: 0.75rem;
		background: var(--background-tertiary);
		color: var(--text-muted);
	}

	.assetBadge--warning {
		background: var(--background-modifier-error);
		color: var(--text-normal);
	}

	.assetBadge--info {
		background: var(--background-modifier-border);
		color: var(--text-normal);
	}

	.assetFields {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.assetFields label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.assetFields input,
	.assetFields select {
		width: 100%;
	}

	.choicesSection table {
		width: 100%;
		border-collapse: collapse;
		table-layout: fixed;
	}

	.choicesSection th,
	.choicesSection td {
		padding: 0.5rem;
		border-bottom: 1px solid var(--background-modifier-border);
		text-align: left;
		word-break: break-word;
		overflow-wrap: anywhere;
		white-space: normal;
	}

	.choicesSection select,
	.assetsSection select {
		max-width: 100%;
	}

	.summary ul {
		margin: 0;
		padding-left: 1rem;
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

	.footer .secondary {
		background: transparent;
	}
</style>
