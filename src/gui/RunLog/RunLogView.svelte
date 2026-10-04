<script lang="ts">
	import { Notice, TFile, type App } from "obsidian";
	import { runLog, type RunLogEntry } from "../../runLog";
	import { openChoiceFile } from "../../engine/choiceFileActions";
	import { closeSettings } from "../../utils/openPluginSettings";

	let { app }: { app: App } = $props();

	let entries = $state(runLog.list());
	$effect(() => runLog.subscribe(() => (entries = runLog.list())));

	const EFFECTS = { created: "created", changed: "added to", unchanged: "nothing to add to" } as const;

	function time(at: string): string {
		const date = new Date(at);
		return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
	}

	function what(entry: RunLogEntry): string {
		if (entry.status === "success") return entry.effect ? EFFECTS[entry.effect] : "ran";
		const label = entry.status === "error" ? "failed" : "cancelled";
		return entry.reason ? `${label}: ${entry.reason}` : label;
	}

	function basename(path: string): string {
		return path.replace(/^.*\//, "").replace(/\.md$/, "");
	}

	async function open(path: string): Promise<void> {
		const file = app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			new Notice(`'${basename(path)}' no longer exists`);
			return;
		}
		closeSettings(app);
		await openChoiceFile({ app, file, opening: { location: "reuse" }, originLeaf: null });
	}
</script>

<div class="qa-run-log">
	{#if entries.length === 0}
		<div class="qa-run-log-empty">No runs yet</div>
	{:else}
		<ul class="qa-run-log-list">
			{#each entries as entry, index (`${entry.at}-${index}`)}
				<li class="qa-run-log-entry" data-status={entry.status}>
					<span class="qa-run-log-time">{time(entry.at)}</span>
					<span class="qa-run-log-name">{entry.choiceName}</span>
					<span class="qa-run-log-what" title={entry.reason}>{what(entry)}</span>
					{#if entry.status === "success" && entry.path}
						<a
							class="qa-run-log-note"
							href={entry.path}
							onclick={(event) => {
								event.preventDefault();
								void open(entry.path!);
							}}>{basename(entry.path)}</a
						>
					{/if}
				</li>
			{/each}
		</ul>
		<div class="qa-run-log-actions">
			<button onclick={() => runLog.clear()}>Clear</button>
		</div>
	{/if}
</div>

<style>
	.qa-run-log-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.qa-run-log-entry {
		display: flex;
		gap: var(--size-4-2);
		align-items: baseline;
		padding: var(--size-4-1) 0;
		min-width: 0;
	}

	.qa-run-log-time {
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
		flex: none;
	}

	.qa-run-log-name {
		font-weight: var(--font-medium);
		flex: none;
	}

	.qa-run-log-what {
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}

	.qa-run-log-entry[data-status="error"] .qa-run-log-what {
		color: var(--text-error);
	}

	.qa-run-log-note {
		flex: none;
	}

	.qa-run-log-empty {
		color: var(--text-muted);
	}

	.qa-run-log-actions {
		display: flex;
		justify-content: flex-end;
		margin-top: var(--size-4-2);
	}
</style>
