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
let assetDecisions = new Map<string, AssetImportMode>();
let pastedContent = "";
let isAnalyzing = false;
let analysisToken = 0;

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
		assetDecisions.set(conflict.originalPath, defaultMode);
	}
}

function updateChoiceDecision(choiceId: string, mode: "import" | "overwrite" | "duplicate" | "skip") {
	choiceDecisions.set(choiceId, mode);
	choiceDecisions = new Map(choiceDecisions);
}

function updateAssetDecision(path: string, mode: "write" | "overwrite" | "skip") {
	assetDecisions.set(path, mode);
	assetDecisions = new Map(assetDecisions);
}

	function onChoiceModeChange(choiceId: string, event: Event) {
		const element = event.currentTarget as HTMLSelectElement;
		const mode = element.value as ChoiceImportMode;
		updateChoiceDecision(choiceId, mode);
	}

function onScriptModeChange(path: string, event: Event) {
	const element = event.currentTarget as HTMLSelectElement;
	const mode = element.value as AssetImportMode;
	updateAssetDecision(path, mode);
}

	async function analyzePastedContent(raw: string) {
		const trimmed = raw.trim();
		const token = ++analysisToken;
		importSummary = null;
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
		if (!loadedPackage || !analysis) {
			new Notice("Load a package before importing.");
			return;
		}

		isImporting = true;
		importSummary = null;
		try {
			const choiceDecisionsList: ChoiceImportDecision[] = analysis.choiceConflicts.map(
				(conflict) => ({
					choiceId: conflict.choiceId,
					mode: choiceDecisions.get(conflict.choiceId) ?? "import",
				}),
			);

		const assetDecisionsList: AssetImportDecision[] = analysis.assetConflicts.map(
			(conflict) => ({
				originalPath: conflict.originalPath,
				mode: assetDecisions.get(conflict.originalPath) ?? (conflict.exists ? "overwrite" : "write"),
			}),
		);

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
				<strong>Scripts:</strong> {loadedPackage.pkg.assets.length}
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
							<tr>
								<td>{conflict.name}</td>
								<td>{formatPathHint(conflict.pathHint)}</td>
								<td>{conflict.exists ? "Yes" : "No"}</td>
								<td>
								<select
									value={choiceDecisions.get(conflict.choiceId) ?? "import"}
									on:change={(event) => onChoiceModeChange(conflict.choiceId, event)}
								>
										<option value="import">Import</option>
										<option value="overwrite">Overwrite</option>
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
			<table>
				<thead>
					<tr>
						<th>Path</th>
						<th>Kind</th>
						<th>Existing</th>
						<th>Action</th>
					</tr>
					</thead>
					<tbody>
						{#each analysis.assetConflicts as conflict}
							<tr>
								<td>{conflict.originalPath}</td>
								<td>{conflict.kind}</td>
								<td>{conflict.exists ? "Yes" : "No"}</td>
								<td>
									<select
										value={assetDecisions.get(conflict.originalPath) ?? "write"}
										on:change={(event) => onScriptModeChange(conflict.originalPath, event)}
									>
										<option value="write">Write</option>
										<option value="overwrite">Overwrite</option>
										<option value="skip">Skip</option>
									</select>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
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
			disabled={isImporting || !loadedPackage || !analysis}
		>
			{#if isImporting}
				Importing…
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
		overflow-x: auto;
	}

	.choicesSection table,
	.assetsSection table {
		width: 100%;
		border-collapse: collapse;
		table-layout: fixed;
	}

	.choicesSection th,
	.choicesSection td,
	.assetsSection th,
	.assetsSection td {
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
