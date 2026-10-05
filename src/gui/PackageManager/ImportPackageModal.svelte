<script lang="ts">
	import type { App } from "obsidian";
	import type IChoice from "../../types/choices/IChoice";
	import type { QuickAddPackage } from "../../types/packages/QuickAddPackage";
	import type { ApplyImportResult } from "../../services/packageImportService";
	import { parseQuickAddPackage } from "../../services/packageImportService";
	import PackageReview from "./PackageReview.svelte";

	let {
		app,
		close,
		onImported,
	}: {
		app: App;
		close: () => void;
		/** Called after a successful import with the choices as they were before it. */
		onImported?: (result: ApplyImportResult, previousChoices: IChoice[]) => void;
	} = $props();

	let pkg = $state<QuickAddPackage | null>(null);
	let parseError = $state<string | null>(null);

	function handleContentInput(event: Event) {
		const raw = (event.currentTarget as HTMLTextAreaElement).value.trim();
		parseError = null;
		if (!raw) {
			pkg = null;
			return;
		}
		try {
			pkg = parseQuickAddPackage(raw);
		} catch (error) {
			parseError = (error as Error)?.message ?? String(error);
			pkg = null;
		}
	}
</script>

<PackageReview {app} {pkg} importLabel="Import package" showDetails onCancel={close} onDone={close} {onImported}>
	{#snippet header()}
		<section class="qa-import-paste">
			<label class="qa-visually-hidden" for="qa-import-json">Package JSON</label>
			<textarea
				id="qa-import-json"
				oninput={handleContentInput}
				placeholder="Paste the contents of a .quickadd.json package here"
				rows="8"
			></textarea>
			{#if parseError}
				<p class="qa-import-status mod-error">{parseError}</p>
			{/if}
		</section>
	{/snippet}
</PackageReview>

<style>
	.qa-import-paste {
		display: flex;
		flex-direction: column;
		gap: var(--size-4-2);
	}

	.qa-import-paste textarea {
		width: 100%;
		font-family: var(--font-monospace);
		font-size: var(--font-ui-small);
		resize: vertical;
	}

	.qa-import-status {
		margin: 0;
		font-size: var(--font-ui-smaller);
		color: var(--text-error);
		overflow-wrap: anywhere;
	}
</style>
