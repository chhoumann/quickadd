<script lang="ts">
	import type { ChoiceConflict } from "../../services/packageImportService";
	import type { PreviewChoice } from "../../services/packagePreview";
	import { effectiveChoiceMode, type ChoiceDecisions } from "./importDecisions";
	import MacroDisclosure from "./MacroDisclosure.svelte";
	import ObsidianIcon from "../components/ObsidianIcon.svelte";
	let { conflicts, choiceDecisions, previewChoiceById, expandedMacros, toggleMacro, onChoiceModeChange }: {
		conflicts: ChoiceConflict[];
		choiceDecisions: ChoiceDecisions;
		previewChoiceById: Map<string, PreviewChoice>;
		expandedMacros: Set<string>;
		toggleMacro: (id: string) => void;
		onChoiceModeChange: (id: string, event: Event) => void;
	} = $props();
	// Choice ids come from the package, which is untrusted, so they are not
	// safe as element ids.
	const uid = $props.id();

	/** "In Parent › Child" for a nested choice; nothing for a top-level one. */
	function describeChoice(conflict: ChoiceConflict): string {
		const parents = (conflict.pathHint ?? []).slice(0, -1);
		const parts: string[] = [];
		if (parents.length > 0) parts.push(`In ${parents.join(" › ")}`);
		if (conflict.exists) parts.push("Already in vault");
		return parts.join(" · ");
	}
</script>

<section class="setting-group qa-import-choices">
	<div class="setting-item setting-item-heading">
		<div class="setting-item-name">Choices</div>
	</div>
	<div class="setting-items">
		{#if conflicts.length === 0}
			<div class="setting-item mod-empty-state">
				<div class="setting-item-info">
					<div class="setting-item-name">
						No choices found in this package.
					</div>
				</div>
			</div>
		{/if}
		{#each conflicts as conflict, index (conflict.choiceId)}
			{@const effectiveMode = effectiveChoiceMode(
				choiceDecisions.get(conflict.choiceId) ?? "import",
				conflict.exists,
			)}
			{@const pc = previewChoiceById.get(conflict.choiceId)}
			{@const hasMacro = (pc?.commands?.length ?? 0) > 0}
			{@const expanded = hasMacro && expandedMacros.has(conflict.choiceId)}
			{@const description = describeChoice(conflict)}
			<div class="setting-item">
				<div class="setting-item-info">
					<div class="setting-item-name">{conflict.name}</div>
					{#if description}
						<div class="setting-item-description">{description}</div>
					{/if}
					{#if hasMacro}
						<button
							type="button"
							class="qa-link-button"
							aria-expanded={expanded}
							onclick={() => toggleMacro(conflict.choiceId)}
						>
							<span class="qa-import-choice-chevron" class:open={expanded}>
								<ObsidianIcon iconId="chevron-right" size={14} />
							</span>
							<span>{expanded ? "Hide macro" : "Show macro"}</span>
						</button>
					{/if}
				</div>
				<div class="setting-item-control">
					<label class="qa-visually-hidden" for={`${uid}-action-${index}`}
						>Action for {conflict.name}</label
					>
					<select
						id={`${uid}-action-${index}`}
						class="dropdown"
						value={effectiveMode}
						onchange={(event) =>
							onChoiceModeChange(conflict.choiceId, event)}
					>
						<option value="import">Import</option>
						{#if conflict.exists}
							<option value="overwrite">Overwrite</option>
						{/if}
						<option value="duplicate">Duplicate</option>
						<option value="skip">Skip</option>
					</select>
				</div>
				{#if expanded}
					<div class="qa-import-choice-macro">
						<MacroDisclosure commands={pc?.commands ?? []} />
					</div>
				{/if}
			</div>
		{/each}
	</div>
</section>

<style>
	.qa-import-choices .setting-item {
		flex-wrap: wrap;
	}

	.qa-import-choices .setting-item-name {
		overflow-wrap: anywhere;
	}

	.qa-import-choices .qa-link-button {
		margin-top: var(--size-4-1);
		font-size: var(--font-ui-smaller);
	}

	/* Pulls the glyph's built-in side bearing back to the text edge. */
	.qa-import-choice-chevron {
		display: inline-flex;
		margin-inline-start: -3px;
		transition: transform 150ms ease;
	}

	.qa-import-choice-chevron.open {
		transform: rotate(90deg);
	}

	.qa-import-choice-macro {
		flex-basis: 100%;
		min-width: 0;
	}
	@media (prefers-reduced-motion: reduce) {
		.qa-import-choice-chevron {
			transition: none;
		}
	}
</style>
