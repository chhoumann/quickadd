<script lang="ts">
	import type { ChoiceConflict } from "../../services/packageImportService";
	import type { PreviewChoice } from "../../services/packagePreview";
	import { effectiveChoiceMode, type ChoiceDecisions } from "./importDecisions";
	import MacroDisclosure from "./MacroDisclosure.svelte";
	let { conflicts, choiceDecisions, previewChoiceById, expandedMacros, toggleMacro, onChoiceModeChange }: {
		conflicts: ChoiceConflict[];
		choiceDecisions: ChoiceDecisions;
		previewChoiceById: Map<string, PreviewChoice>;
		expandedMacros: Set<string>;
		toggleMacro: (id: string) => void;
		onChoiceModeChange: (id: string, event: Event) => void;
	} = $props();
	function formatPathHint(pathHint: string[]): string {
		if (!pathHint || pathHint.length === 0) return "Root";
		return pathHint.slice(0, -1).join(" › ") || "Root";
	}

</script>
		<section class="choicesSection">
			<h3>Choices</h3>
			{#if conflicts.length === 0}
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
						{#each conflicts as conflict (conflict.choiceId)}
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
<style>
	.choicesSection {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		max-width: 100%;
	}
	.choicesSection * { box-sizing: border-box; }


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

	:global(.is-mobile) .macroToggle {
		min-height: 36px;
		padding: 0.4rem 0.3rem;
	}
</style>
