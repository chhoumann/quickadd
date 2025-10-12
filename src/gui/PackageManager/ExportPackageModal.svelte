<script lang="ts">
	import type { App } from "obsidian";
	import { Notice } from "obsidian";
	import type QuickAdd from "../../main";
	import type IChoice from "../../types/choices/IChoice";
	import type IMultiChoice from "../../types/choices/IMultiChoice";
	import {
		collectChoiceClosure,
		collectScriptDependencies,
		collectFileDependencies,
	} from "../../utils/packageTraversal";
	import {
		buildPackage,
		generateDefaultPackagePath,
		writePackageToVault,
		type MissingAsset,
	} from "../../services/packageExportService";
	import type { QuickAddPackageAssetKind } from "../../types/packages/QuickAddPackage";

	export let app: App;
	export let plugin: QuickAdd;
	export let allChoices: IChoice[];
	export let close: () => void;

	interface FlatChoice {
		choice: IChoice;
		id: string;
		path: string[];
		depth: number;
	}

	interface Summary {
		rootCount: number;
		totalChoices: number;
		dependencyCount: number;
		missingChoiceIds: string[];
		userScripts: number;
		conditionalScripts: number;
		templateFiles: number;
		captureTemplates: number;
	}

	type ExportWarnings = {
		missingChoices: string[];
		missingAssets: MissingAsset[];
	};

	const assetLabels: Record<QuickAddPackageAssetKind, string> = {
		"user-script": "User script",
		"conditional-script": "Conditional script",
		template: "Template file",
		"capture-template": "Capture template",
	};

	let searchQuery = "";
	let selectedRootIds = new Set<string>();
	let outputPath = generateDefaultPackagePath();
	let exportWarnings: ExportWarnings | null = null;
	let actionInProgress: "copy" | "save" | null = null;

	$: flatChoices = flattenChoicesWithPath(allChoices);
	$: filteredChoices = filterFlatChoices(flatChoices, searchQuery);
	$: summary = computeSummary(allChoices, selectedRootIds);
	$: choiceNameById = new Map<string, string>(
		flatChoices.map((entry) => [entry.id, entry.path.join(" / ")]),
	);

	function flattenChoicesWithPath(
		choices: IChoice[],
		parentPath: string[] = [],
		depth = 0,
	): FlatChoice[] {
		const result: FlatChoice[] = [];
		for (const choice of choices) {
			const path = [...parentPath, choice.name];
			result.push({ choice, id: choice.id, path, depth });
			if (isMultiChoice(choice)) {
				result.push(
					...flattenChoicesWithPath(
						(choice as IMultiChoice).choices ?? [],
						path,
						depth + 1,
					),
				);
			}
		}
		return result;
	}

	function isMultiChoice(choice: IChoice): choice is IMultiChoice {
		return choice.type === "Multi";
	}

	function filterFlatChoices(list: FlatChoice[], query: string): FlatChoice[] {
		const trimmed = query.trim().toLowerCase();
		if (!trimmed) return list;

		return list.filter((entry) => {
			const composite = `${entry.path.join(" ")} ${entry.choice.type}`.toLowerCase();
			return composite.includes(trimmed);
		});
	}

	function toggleChoice(id: string) {
		const next = new Set(selectedRootIds);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		selectedRootIds = next;
		exportWarnings = null;
	}

	function selectAllFiltered() {
		const next = new Set(selectedRootIds);
		for (const entry of filteredChoices) {
			next.add(entry.id);
		}
		selectedRootIds = next;
		exportWarnings = null;
	}

	function clearSelection() {
		selectedRootIds = new Set();
		exportWarnings = null;
	}

	function computeSummary(all: IChoice[], selected: Set<string>): Summary {
		const roots = Array.from(selected);
		if (roots.length === 0) {
			return {
				rootCount: 0,
				totalChoices: 0,
				dependencyCount: 0,
				missingChoiceIds: [],
				userScripts: 0,
				conditionalScripts: 0,
				templateFiles: 0,
				captureTemplates: 0,
			};
		}

		const closure = collectChoiceClosure(all, roots);
		const scripts = collectScriptDependencies(closure.catalog, closure.choiceIds);
		const files = collectFileDependencies(closure.catalog, closure.choiceIds);

		return {
			rootCount: roots.length,
			totalChoices: closure.choiceIds.length,
			dependencyCount: Math.max(closure.choiceIds.length - roots.length, 0),
			missingChoiceIds: closure.missingChoiceIds,
			userScripts: scripts.userScriptPaths.size,
			conditionalScripts: scripts.conditionalScriptPaths.size,
			templateFiles: files.templatePaths.size,
			captureTemplates: files.captureTemplatePaths.size,
		};
	}

	function captureWarnings(result: Awaited<ReturnType<typeof buildPackage>>): ExportWarnings | null {
		const { missingChoiceIds, missingAssets } = result;
		if (missingChoiceIds.length === 0 && missingAssets.length === 0) {
			return null;
		}
		return { missingChoices: missingChoiceIds, missingAssets };
	}

	async function preparePackage(): Promise<Awaited<ReturnType<typeof buildPackage>> | null> {
		if (selectedRootIds.size === 0) {
			new Notice("Select at least one choice to export.");
			return null;
		}

		try {
			const result = await buildPackage(app, {
				choices: allChoices,
				rootChoiceIds: Array.from(selectedRootIds),
				quickAddVersion: plugin.manifest.version,
			});

			exportWarnings = captureWarnings(result);
			return result;
		} catch (error) {
			console.error(error);
			exportWarnings = null;
			new Notice(`Export failed: ${(error as Error)?.message ?? String(error)}`);
			return null;
		}
	}

	async function copyPackage() {
		if (actionInProgress) return;

		actionInProgress = "copy";
		try {
			const buildResult = await preparePackage();
			if (!buildResult) return;

			const serialized = JSON.stringify(buildResult.pkg, null, 2);
			await copyToClipboard(serialized);

			new Notice(
				`Copied package (${buildResult.pkg.choices.length} choice${
					buildResult.pkg.choices.length === 1 ? "" : "s"
				}) to clipboard.`,
			);

			if (exportWarnings) {
				new Notice("Package copied with warnings. Review details below.");
			} else {
				close();
			}
		} catch (error) {
			console.error(error);
			new Notice(`Copy failed: ${(error as Error)?.message ?? String(error)}`);
		} finally {
			actionInProgress = null;
		}
	}

	async function savePackage() {
		if (actionInProgress) return;

		const trimmedPath = outputPath.trim();
		if (!trimmedPath) {
			new Notice("Enter a file path before saving.");
			return;
		}

		actionInProgress = "save";
		try {
			const buildResult = await preparePackage();
			if (!buildResult) return;

			await writePackageToVault(app, buildResult.pkg, trimmedPath);
			new Notice(
				`Saved package (${buildResult.pkg.choices.length} choice${
					buildResult.pkg.choices.length === 1 ? "" : "s"
				}) to '${trimmedPath}'.`,
			);

			if (exportWarnings) {
				new Notice("Package saved with warnings. Review details below.");
			} else {
				close();
			}
		} catch (error) {
			console.error(error);
			new Notice(`Save failed: ${(error as Error)?.message ?? String(error)}`);
		} finally {
			actionInProgress = null;
		}
	}

	async function copyToClipboard(text: string) {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return;
		}

		const textarea = document.createElement("textarea");
		textarea.value = text;
		textarea.setAttribute("readonly", "true");
		textarea.style.position = "fixed";
		textarea.style.opacity = "0";
		document.body.appendChild(textarea);
		textarea.focus();
		textarea.select();
		const successful = document.execCommand("copy");
		document.body.removeChild(textarea);
		if (!successful) {
			throw new Error("Clipboard copy is not supported in this environment.");
		}
	}
</script>

<div class="exportPackageModal">
	<header>
		<h2>Export QuickAdd Package</h2>
		<p>Select choices to bundle. Dependencies are added automatically.</p>
	</header>

	<section class="controls">
		<input
			type="text"
			placeholder="Filter choices"
			bind:value={searchQuery}
			autocapitalize="off"
			autocorrect="off"
			spellcheck={false}
		/>
		<div class="controlButtons">
			<button type="button" on:click={selectAllFiltered}>Select visible</button>
			<button type="button" on:click={clearSelection}>Clear selection</button>
		</div>
	</section>

	<section class="choiceList">
		{#if filteredChoices.length === 0}
			<p class="emptyState">No choices match the current filter.</p>
		{:else}
			<ul>
				{#each filteredChoices as entry (entry.id)}
					<li style={`padding-left: ${entry.depth * 16}px`}>
						<label>
							<input
								type="checkbox"
								checked={selectedRootIds.has(entry.id)}
								on:change={() => toggleChoice(entry.id)}
							/>
							<span class="choiceName">{entry.path.at(-1)}</span>
							{#if entry.path.length > 1}
								<span class="choicePath">
									{entry.path.slice(0, -1).join(" › ")}
								</span>
							{/if}
							<span class="choiceType">{entry.choice.type}</span>
						</label>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="summary">
		<h3>Package summary</h3>
		<div class="summaryGrid">
			<div>
				<strong>{summary.rootCount}</strong>
				<span>Selected choices</span>
			</div>
			<div>
				<strong>{summary.totalChoices}</strong>
				<span>Total packaged</span>
			</div>
			<div>
				<strong>{summary.dependencyCount}</strong>
				<span>Auto-included</span>
			</div>
			<div>
				<strong>{summary.userScripts + summary.conditionalScripts}</strong>
				<span>Scripts embedded</span>
			</div>
			<div>
				<strong>{summary.templateFiles + summary.captureTemplates}</strong>
				<span>Templates embedded</span>
			</div>
		</div>
		{#if summary.missingChoiceIds.length > 0}
			<div class="warning">
				<strong>Missing dependencies detected</strong>
				<p>
					The following choice IDs were referenced but not found:
					{summary.missingChoiceIds.join(", ")}
				</p>
			</div>
		{/if}
	</section>

	{#if exportWarnings}
		<section class="warning">
			<h4>Warnings</h4>
			{#if exportWarnings.missingChoices.length > 0}
				<p>
					Missing choices:
					{exportWarnings.missingChoices
						.map((id) => choiceNameById.get(id) ?? id)
						.join(", ")}
				</p>
			{/if}
			{#if exportWarnings.missingAssets.length > 0}
				<div>
					<p>Missing assets:</p>
					<ul>
						{#each exportWarnings.missingAssets as asset}
							<li>{asset.originalPath} <span class="assetKind">({assetLabels[asset.kind]})</span></li>
						{/each}
					</ul>
				</div>
			{/if}
		</section>
	{/if}

	<section class="actions">
		<div class="actionGroup">
			<button
				type="button"
				class="secondary"
				on:click={copyPackage}
				disabled={actionInProgress !== null}
			>
				{#if actionInProgress === "copy"}
					Copying…
				{:else}
					Copy JSON
				{/if}
			</button>
		</div>
		<div class="actionGroup">
			<label>
				<span>Save to file</span>
				<div class="saveRow">
					<input
						type="text"
						bind:value={outputPath}
						placeholder="QuickAdd Packages/quickadd-package-YYYY-MM-DD.quickadd.json"
					/>
					<button
						type="button"
						on:click={savePackage}
						disabled={actionInProgress !== null}
					>
						{#if actionInProgress === "save"}
							Saving…
						{:else}
							Save to file
						{/if}
					</button>
				</div>
			</label>
		</div>
	</section>

	<section class="footer">
		<button type="button" class="secondary" on:click={close} disabled={actionInProgress !== null}>
			Cancel
		</button>
	</section>
</div>

<style>
	.exportPackageModal {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-width: 520px;
		max-height: 70vh;
	}

	header p {
		margin: 0;
		color: var(--text-muted);
	}

	.controls {
		display: flex;
		gap: 0.75rem;
		align-items: center;
	}

	.controls input {
		flex: 1;
	}

	.controlButtons {
		display: flex;
		gap: 0.5rem;
	}

	.choiceList {
		flex: 1;
		min-height: 180px;
		max-height: 260px;
		overflow: auto;
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		padding: 0.5rem;
	}

	.choiceList ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.choiceList label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
	}

	.choiceList label:hover {
		background: var(--background-modifier-hover);
	}

	.choiceName {
		font-weight: 600;
	}

	.choicePath {
		color: var(--text-muted);
		font-size: 0.8rem;
	}

	.choiceType {
		margin-left: auto;
		font-size: 0.75rem;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.emptyState {
		margin: 0;
		color: var(--text-muted);
		text-align: center;
	}

	.summary {
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.summary h3 {
		margin: 0 0 0.5rem 0;
		font-size: 1rem;
	}

	.summaryGrid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 0.75rem;
	}

	.summaryGrid div {
		display: flex;
		flex-direction: column;
	}

	.summaryGrid strong {
		font-size: 1.1rem;
	}

	.warning {
		border: 1px solid var(--background-modifier-error);
		background: var(--background-modifier-error);
		border-radius: 4px;
		padding: 0.5rem;
		color: var(--text-normal);
	}

	.warning ul {
		margin: 0.25rem 0 0 1rem;
		padding: 0;
	}

	.assetKind {
		color: var(--text-muted);
	}

	.actions {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.actionGroup {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.saveRow {
		display: flex;
		gap: 0.5rem;
	}

	.saveRow input {
		flex: 1;
	}

	.footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	.footer button.secondary {
		background: transparent;
	}
</style>
