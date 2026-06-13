<script lang="ts">
import type { App } from "obsidian";
import { Notice } from "obsidian";
import { onMount } from "svelte";
import {
	getActiveCanvasSelectionNodeIdForPath,
	readCanvasNodeOptions,
	resolveStaticCanvasTargetFile,
	type CanvasNodeOption,
} from "../canvasNodes";

/**
 * Reactive port of captureChoiceBuilder.renderCanvasNodePicker. The imperative
 * renderList() rebuild is now a reactive {#each}; selecting a node mutates
 * `nodeId` and the list re-derives automatically.
 */
let {
	nodeId = $bindable(),
	canvasTargetPath,
	app,
}: {
	nodeId: string | undefined;
	canvasTargetPath: string;
	app: App;
} = $props();

let nodeOptions = $state<CanvasNodeOption[]>([]);
let phase = $state<"loading" | "empty" | "ready">("loading");
let emptyMessage = $state("");
let filterQuery = $state("");

const filteredOptions = $derived.by(() => {
	const query = filterQuery.trim().toLowerCase();
	return query.length
		? nodeOptions.filter((option) => option.searchText.includes(query))
		: nodeOptions;
});

const selectedNodeId = $derived((nodeId ?? "").trim());

const statusText = $derived(
	phase === "ready"
		? `Showing ${filteredOptions.length} of ${nodeOptions.length} nodes`
		: phase === "empty"
			? emptyMessage
			: "Loading canvas nodes…",
);

onMount(() => {
	void (async () => {
		const canvasFile = resolveStaticCanvasTargetFile(app, canvasTargetPath);
		if (!canvasFile) {
			emptyMessage =
				"Node picker works for direct .canvas paths that already exist in your vault. Format syntax paths cannot be listed here.";
			phase = "empty";
			return;
		}
		nodeOptions = await readCanvasNodeOptions(app, canvasFile);
		if (nodeOptions.length === 0) {
			emptyMessage = "No selectable nodes found in the target canvas.";
			phase = "empty";
			return;
		}
		phase = "ready";
	})();
});

function applyNodeId(id: string) {
	nodeId = id;
}

function openCanvas() {
	const canvasFile = resolveStaticCanvasTargetFile(app, canvasTargetPath);
	if (!canvasFile) {
		new Notice("Target canvas file was not found.");
		return;
	}
	void app.workspace
		.getLeaf(true)
		.openFile(canvasFile)
		.catch(() => new Notice("Could not open target canvas."));
}

function useActiveSelection() {
	const activeSelectionNodeId = getActiveCanvasSelectionNodeIdForPath(
		app,
		canvasTargetPath,
	);
	if (!activeSelectionNodeId) {
		new Notice(
			"Open the target canvas and select exactly one card to use this action.",
		);
		return;
	}
	const selectedOption = nodeOptions.find(
		(option) => option.id === activeSelectionNodeId,
	);
	if (!selectedOption) {
		new Notice(
			phase === "ready"
				? "The selected node was not found in the loaded canvas."
				: "Canvas nodes are still loading. Wait a moment and try again.",
		);
		return;
	}
	if (!selectedOption.capturable) {
		new Notice(selectedOption.capturableReason);
		return;
	}
	applyNodeId(activeSelectionNodeId);
}

function copyNodeId(id: string) {
	void (async () => {
		try {
			await navigator.clipboard.writeText(id);
			new Notice(`Copied node id ${id}`);
		} catch {
			new Notice("Could not copy node id automatically.");
		}
	})();
}

function typeLabel(type: CanvasNodeOption["type"]): string {
	return type === "text" ? "TEXT" : type === "file" ? "FILE" : "NODE";
}
</script>

<div class="qa-canvas-node-picker">
	<div class="qa-canvas-node-actions">
		<button type="button" onclick={openCanvas}>Open target canvas</button>
		<button type="button" onclick={useActiveSelection}>
			Use selected in open canvas
		</button>
		<button type="button" onclick={() => applyNodeId("")}>Clear</button>
	</div>

	<div class="qa-canvas-node-filter">
		<input
			type="text"
			placeholder="Filter by card text, file path, or node id…"
			aria-label="Filter canvas nodes"
			bind:value={filterQuery}
		/>
	</div>

	<div class="qa-canvas-node-status">{statusText}</div>

	<div class="qa-canvas-node-list">
		{#if phase === "empty"}
			<div class="qa-canvas-node-empty">{emptyMessage}</div>
		{:else if phase === "ready" && filteredOptions.length === 0}
			<div class="qa-canvas-node-empty">No nodes match the current filter.</div>
		{:else}
			{#each filteredOptions as option (option.id)}
				{@const isSelected = selectedNodeId === option.id}
				<div class="qa-canvas-node-item" class:is-selected={isSelected}>
					<div class="qa-canvas-node-item-header">
						<span class="qa-canvas-node-type is-{option.type}">
							{typeLabel(option.type)}
						</span>
						<span class="qa-canvas-node-title">{option.title}</span>
					</div>
					<div class="qa-canvas-node-subtitle">{option.subtitle}</div>
					<div class="qa-canvas-node-meta"><code>{option.id}</code></div>
					<div class="qa-canvas-node-item-actions">
						{#if option.capturable}
							<button
								type="button"
								class:mod-cta={isSelected}
								onclick={() => applyNodeId(option.id)}
							>
								{isSelected ? "Selected" : "Use node"}
							</button>
						{:else}
							<button type="button" disabled title={option.capturableReason}>
								Unavailable
							</button>
						{/if}
						<button type="button" onclick={() => copyNodeId(option.id)}>
							Copy ID
						</button>
					</div>
				</div>
			{/each}
		{/if}
	</div>
</div>
