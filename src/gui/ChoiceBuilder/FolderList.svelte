<script lang="ts">
	import { Platform } from "obsidian";
	import { alertToScreenReader, type DndEvent, dndzone, SOURCES } from "svelte-dnd-action";
	import {
		applyOrder,
		baseDndOptions,
		capturePlaceholderRecovery,
		moveById,
		type PlaceholderRecovery,
		type Reorderable,
		stripShadow,
	} from "../shared/dndReorder";
	import { createDragArming } from "../shared/dragArming.svelte";
	import DragHandle from "../components/DragHandle.svelte";
	import IconButton from "../components/IconButton.svelte";
	import type { FolderListProps } from "./folderListProps.svelte";

	interface FolderDragItem extends Reorderable {
		id: string;
	}

	let { folders, onChange }: FolderListProps = $props();

	const zoneId = $props.id();
	const zoneType = `folder:${zoneId}`;
	const isMobile = Platform.isMobile;
	const drag = createDragArming();
	const dragDisabled = $derived(!isMobile && !drag.armed);

	function toItems(paths: readonly string[]): FolderDragItem[] {
		return paths.map((id) => ({ id }));
	}

	let preview = $state<FolderDragItem[] | null>(null);
	const items = $derived(preview ?? toItems(folders));

	let placeholderRecovery: PlaceholderRecovery<FolderDragItem> | null = null;

	function handleConsider(e: CustomEvent<DndEvent<FolderDragItem>>) {
		drag.markStarted();
		const reported = e.detail.items;
		placeholderRecovery =
			capturePlaceholderRecovery(reported, e.detail.info.id) ?? placeholderRecovery;
		preview = stripShadow(reported);
	}

	function handleFinalize(e: CustomEvent<DndEvent<FolderDragItem>>) {
		let next = stripShadow(e.detail.items);
		const draggedId = e.detail.info.id;
		if (
			placeholderRecovery?.item.id === draggedId &&
			!next.some((item) => item.id === draggedId)
		) {
			next = [...next];
			next.splice(
				Math.min(placeholderRecovery.index, next.length),
				0,
				placeholderRecovery.item,
			);
		}
		onChange(applyOrder(toItems(folders), next).map((item) => item.id));
		preview = null;
		placeholderRecovery = null;
		if (e.detail.info.source === SOURCES.POINTER) {
			drag.reset();
		}
	}

	function moveFolder(id: string, delta: -1 | 1) {
		const next = moveById(toItems(folders), id, delta);
		if (!next) return;
		onChange(next.map((item) => item.id));
		const target = next.findIndex((item) => item.id === id);
		alertToScreenReader(`Moved ${id} to position ${target + 1} of ${next.length}`);
	}

	function removeFolder(path: string) {
		onChange(folders.filter((folder) => folder !== path));
	}

	let startDrag = () => {
		drag.startDrag();
	};
</script>

<ol
	class="qa-folder-list"
	use:dndzone={baseDndOptions({
		items,
		dragDisabled,
		type: zoneType,
		resolveLabel: (item) => item.id,
	})}
	onconsider={handleConsider}
	onfinalize={handleFinalize}
>
	{#each stripShadow(items) as folder (folder.id)}
		<li class="quickAddCommandListItem">
			<span class="quickAddCommandLabel">{folder.id}</span>
			<div class="quickAddCommandControls">
				<IconButton
					iconId="trash-2"
					label={`Remove folder ${folder.id}`}
					onclick={() => removeFolder(folder.id)}
				/>
				<DragHandle
					label={`Reorder ${folder.id}`}
					{dragDisabled}
					onDragStart={startDrag}
					onMoveUp={() => moveFolder(folder.id, -1)}
					onMoveDown={() => moveFolder(folder.id, 1)}
				/>
			</div>
		</li>
	{/each}
</ol>

<style>
	.qa-folder-list {
		display: grid;
		grid-template-columns: auto;
		width: auto;
		margin: 12px 0;
		padding: 0;
		list-style: none;
	}
</style>
