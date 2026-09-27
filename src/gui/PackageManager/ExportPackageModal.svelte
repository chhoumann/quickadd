<script lang="ts">
	import { filterFlatChoices, computeRootSelections, computeSummary } from "./exportSelection";
	import type { App } from "obsidian";
	import { Notice } from "obsidian";
	import type QuickAdd from "../../main";
	import type IChoice from "../../types/choices/IChoice";
	import type IMultiChoice from "../../types/choices/IMultiChoice";

	import {
		childChoicesOf,
		flattenChoicesWithPath,
		isChoiceLike,
	} from "../../utils/choiceUtils";
	import {
		buildPackage,
		generateDefaultPackagePath,
		writePackageToVault,
		type MissingAsset,
	} from "../../services/packageExportService";
	import type { QuickAddPackageAssetKind } from "../../types/packages/QuickAddPackage";
	import ObsidianIcon from "../components/ObsidianIcon.svelte";

	let {
		app,
		plugin,
		allChoices,
		close,
	}: {
		app: App;
		plugin: QuickAdd;
		allChoices: IChoice[];
		close: () => void;
	} = $props();

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

	let searchQuery = $state("");
	let selectedChoiceIds = $state(new Set<string>());
	let excludedChoiceIds = $state(new Set<string>());
	let outputPath = $state(generateDefaultPackagePath());
	let exportWarnings = $state<ExportWarnings | null>(null);
	let actionInProgress = $state<"copy" | "save" | null>(null);

	const flatChoices = $derived(flattenChoicesWithPath(allChoices));
	const filteredChoices = $derived(filterFlatChoices(flatChoices, searchQuery));
	const rootChoiceIds = $derived(computeRootSelections(flatChoices, selectedChoiceIds));
	const summary = $derived(computeSummary(allChoices, rootChoiceIds, excludedChoiceIds));
	const choiceNameById = $derived(
		new Map<string, string>(
			flatChoices.map((entry) => [entry.id, entry.path.join(" / ")]),
		),
	);

	function isMultiChoice(choice: IChoice): choice is IMultiChoice {
		return choice.type === "Multi";
	}

	function getDescendantIds(choice: IChoice): string[] {
		const ids: string[] = [];
		for (const child of childChoicesOf(choice)) {
			if (!isChoiceLike(child)) continue;
			ids.push(child.id, ...getDescendantIds(child));
		}
		return ids;
	}

	function setSelectionForChoice(choice: IChoice, shouldSelect: boolean) {
		const affectedIds = [choice.id, ...getDescendantIds(choice)];
		const nextSelected = new Set(selectedChoiceIds);
		const nextExcluded = new Set(excludedChoiceIds);
		for (const id of affectedIds) {
			if (shouldSelect) {
				nextSelected.add(id);
				nextExcluded.delete(id);
			} else {
				nextSelected.delete(id);
				nextExcluded.add(id);
			}
		}
		selectedChoiceIds = nextSelected;
		if (!shouldSelect || excludedChoiceIds.size > 0) excludedChoiceIds = nextExcluded;
	}

	function toggleChoice(id: string) {
		const entry = flatChoices.find((item) => item.id === id);
		if (!entry) return;
		const isSelected = selectedChoiceIds.has(id);
		setSelectionForChoice(entry.choice, !isSelected);
		exportWarnings = null;
	}

	function selectAllFiltered() {
		for (const entry of filteredChoices) {
			setSelectionForChoice(entry.choice, true);
		}
		exportWarnings = null;
	}

	function clearSelection() {
		selectedChoiceIds = new Set();
		excludedChoiceIds = new Set();
		exportWarnings = null;
	}

	function captureWarnings(result: Awaited<ReturnType<typeof buildPackage>>): ExportWarnings | null {
		const { missingChoiceIds, missingAssets } = result;
		if (missingChoiceIds.length === 0 && missingAssets.length === 0) {
			return null;
		}
		return { missingChoices: missingChoiceIds, missingAssets };
	}

	async function preparePackage(): Promise<Awaited<ReturnType<typeof buildPackage>> | null> {
		if (rootChoiceIds.length === 0) {
			new Notice("Select at least one choice to export.");
			return null;
		}

		try {
			const result = await buildPackage(app, {
				choices: allChoices,
				rootChoiceIds,
				excludedChoiceIds: Array.from(excludedChoiceIds),
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

			const { overwritten } = await writePackageToVault(
				app,
				buildResult.pkg,
				trimmedPath,
			);
			const choiceCount = buildResult.pkg.choices.length;
			const choiceLabel = `${choiceCount} choice${choiceCount === 1 ? "" : "s"}`;
			new Notice(
				overwritten
					? `Overwrote package (${choiceLabel}) at '${trimmedPath}'.`
					: `Saved package (${choiceLabel}) to '${trimmedPath}'.`,
			);

			if (exportWarnings) {
				new Notice("Package saved with warnings. Review details below.");
			} else {
				close();
			}
		} catch (error) {
			const message = (error as Error)?.message ?? String(error);
			// Declining the overwrite confirmation is a deliberate no-op, not a
			// failure: surface it neutrally instead of "Save failed: Save cancelled: …".
			if (message.startsWith("Save cancelled:")) {
				new Notice("Save cancelled.");
				return;
			}
			console.error(error);
			new Notice(`Save failed: ${message}`);
		} finally {
			actionInProgress = null;
		}
	}

	async function copyToClipboard(text: string) {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return;
		}

		const textarea = document.body.createEl("textarea");
		textarea.value = text;
		textarea.setAttribute("readonly", "true");
		textarea.style.position = "fixed";
		textarea.style.opacity = "0";
		textarea.focus();
		textarea.select();
		const successful = document.execCommand("copy");
		document.body.removeChild(textarea);
		if (!successful) {
			throw new Error("Clipboard copy is not supported in this environment.");
		}
	}
</script>

<div class="qa-package-dialog">
	<div class="qa-package-body">
		<section class="qa-export-select">
			<div class="qa-export-controls">
				<div class="search-input-container">
					<label class="qa-visually-hidden" for="qa-export-filter"
						>Filter choices</label
					>
					<input
						id="qa-export-filter"
						type="search"
						enterkeyhint="search"
						placeholder="Filter choices..."
						bind:value={searchQuery}
						autocapitalize="off"
						autocorrect="off"
						spellcheck={false}
					/>
				</div>
				<button type="button" onclick={selectAllFiltered}>Select visible</button>
				<button type="button" onclick={clearSelection}>Clear selection</button>
			</div>

			<div class="setting-group">
				<div class="setting-items qa-export-list">
					{#if filteredChoices.length === 0}
						<div class="setting-item mod-empty-state">
							<div class="setting-item-info">
								<div class="setting-item-name">
									No choices match the current filter.
								</div>
							</div>
						</div>
					{:else}
						{#each filteredChoices as entry (entry.id)}
							<label
								class="qa-export-choice"
								style={`--qa-export-depth: ${entry.depth}`}
							>
								<input
									type="checkbox"
									checked={selectedChoiceIds.has(entry.id)}
									onchange={() => toggleChoice(entry.id)}
								/>
								<span class="qa-export-choice-name">{entry.path.at(-1)}</span>
								{#if entry.path.length > 1}
									<span class="qa-export-choice-path">
										{entry.path.slice(0, -1).join(" › ")}
									</span>
								{/if}
								<span class="flair qa-export-choice-type">{entry.choice.type}</span>
							</label>
						{/each}
					{/if}
				</div>
			</div>
		</section>

		<section class="setting-group mod-list">
			<div class="setting-item setting-item-heading">
				<div class="setting-item-name">Package summary</div>
			</div>
			<div class="setting-items">
				{#each [
					["Selected choices", summary.rootCount],
					["Total packaged", summary.totalChoices],
					["Auto-included", summary.dependencyCount],
					["Scripts embedded", summary.userScripts + summary.conditionalScripts],
					["Templates embedded", summary.templateFiles + summary.captureTemplates],
				] as [label, value] (label)}
					<div class="setting-item">
						<div class="setting-item-info">
							<div class="setting-item-name">{label}</div>
						</div>
						<div class="setting-item-control">
							<span class="setting-item-value qa-export-count">{value}</span>
						</div>
					</div>
				{/each}
			</div>
		</section>

		{#if summary.missingChoiceIds.length > 0}
			<section class="callout qa-export-callout" data-callout="warning">
				<div class="callout-title">
					<div class="callout-icon">
						<ObsidianIcon iconId="alert-triangle" />
					</div>
					<div class="callout-title-inner">Missing dependencies detected</div>
				</div>
				<div class="callout-content">
					<p>
						The following choice IDs were referenced but not found:
						{summary.missingChoiceIds.join(", ")}
					</p>
				</div>
			</section>
		{/if}

		{#if exportWarnings}
			<section class="callout qa-export-callout" data-callout="warning">
				<div class="callout-title">
					<div class="callout-icon">
						<ObsidianIcon iconId="alert-triangle" />
					</div>
					<div class="callout-title-inner">Warnings</div>
				</div>
				<div class="callout-content">
					{#if exportWarnings.missingChoices.length > 0}
						<p>
							Missing choices:
							{exportWarnings.missingChoices
								.map((id) => choiceNameById.get(id) ?? id)
								.join(", ")}
						</p>
					{/if}
					{#if exportWarnings.missingAssets.length > 0}
						<p>Missing assets:</p>
						<ul>
							{#each exportWarnings.missingAssets as asset (asset.path)}
								<li>
									<code>{asset.path}</code>
									<span class="qa-export-asset-kind">{assetLabels[asset.kind]}</span>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			</section>
		{/if}

		<section class="setting-group qa-export-save-group">
			<div class="setting-items">
				<div class="setting-item qa-export-save">
					<div class="setting-item-info">
						<label class="setting-item-name" for="qa-export-path">Save to file</label>
					</div>
					<div class="setting-item-control">
						<input
							id="qa-export-path"
							type="text"
							bind:value={outputPath}
							placeholder="QuickAdd Packages/quickadd-package-YYYY-MM-DD.quickadd.json"
						/>
						<button
							type="button"
							onclick={savePackage}
							disabled={actionInProgress !== null}
						>
							{#if actionInProgress === "save"}
								Saving…
							{:else}
								Save
							{/if}
						</button>
					</div>
				</div>
			</div>
		</section>
	</div>

	<div class="modal-button-container">
		<button type="button" onclick={close} disabled={actionInProgress !== null}>
			Cancel
		</button>
		<button
			type="button"
			onclick={copyPackage}
			disabled={actionInProgress !== null}
		>
			{#if actionInProgress === "copy"}
				Copying…
			{:else}
				Copy JSON
			{/if}
		</button>
	</div>
</div>

<style>
	.qa-export-select {
		display: flex;
		flex-direction: column;
		gap: var(--size-4-3);
	}

	.qa-export-controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--size-4-2);
	}

	.qa-export-controls .search-input-container {
		flex: 1 1 12rem;
	}

	.qa-export-list {
		max-height: 260px;
		overflow-y: auto;
		padding: var(--size-4-1);
	}

	/* List padding + row padding lands on the 16px inset of the mod-list rows
	   below, so every row in the modal starts on the same edge. */
	.qa-export-choice {
		display: flex;
		align-items: center;
		gap: var(--size-4-2);
		padding: var(--size-4-1) var(--size-4-3);
		padding-inline-start: calc(
			var(--size-4-3) + var(--qa-export-depth, 0) * var(--size-4-4)
		);
		font-size: var(--font-ui-small);
		border-radius: var(--radius-s);
		cursor: var(--cursor);
	}

	.qa-export-choice:hover {
		background-color: var(--background-modifier-hover);
	}

	.qa-export-choice input {
		flex-shrink: 0;
		margin: 0;
	}

	.qa-export-choice-name {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.qa-export-choice-path {
		min-width: 0;
		color: var(--text-muted);
		font-size: var(--font-ui-smaller);
		overflow-wrap: anywhere;
	}

	.qa-export-choice-type {
		margin-inline-start: auto;
	}

	.qa-export-count {
		color: var(--text-normal);
		font-variant-numeric: tabular-nums;
	}

	.qa-export-callout {
		margin: 0;
	}

	.qa-export-callout .callout-content {
		font-size: var(--font-ui-small);
	}

	.qa-export-callout p {
		margin: var(--size-4-2) 0 0;
	}

	.qa-export-callout ul {
		margin: var(--size-4-1) 0 0;
		padding-inline-start: var(--size-4-5);
	}

	.qa-export-callout code {
		font-family: var(--font-monospace);
		font-size: var(--code-size);
		background-color: var(--code-background);
		border-radius: var(--code-radius);
		padding: 0.1em 0.25em;
		overflow-wrap: anywhere;
	}

	.qa-export-asset-kind {
		margin-inline-start: var(--size-4-1);
		color: var(--text-muted);
		font-size: var(--font-ui-smaller);
	}

	/* Same inset as the mod-list summary rows above. Not mod-list itself:
	   Obsidian keeps mod-list rows horizontal on phones, where this row needs
	   to stack. */
	.qa-export-save-group {
		--setting-items-padding-x: var(--size-4-4);
		--setting-items-padding-y: var(--size-4-3);
	}

	/* The path is the point of this row: let the input take the width the
	   short name leaves over. */
	.qa-export-save {
		align-items: center;
	}

	/* Phones stack the row and make controls full width; wrap so the path
	   and Save each get a full line. */
	:global(.is-phone) .qa-export-save .setting-item-control {
		flex-wrap: wrap;
	}

	.qa-export-save .setting-item-info {
		flex: 0 0 auto;
	}

	.qa-export-save input {
		flex: 1 1 auto;
		min-width: 0;
	}
</style>
