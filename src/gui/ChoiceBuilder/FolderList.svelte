<script lang="ts">
	import { type DndEvent, dndzone, SOURCES } from "svelte-dnd-action";
	import {
		baseDndOptions,
		createDropRecovery,
		type Reorderable,
		showDragPillOnStart,
		stripShadow,
	} from "../shared/dndReorder";
	import { createDragArming } from "../shared/dragArming.svelte";
	import { moveByKeyboard } from "../shared/keyboardReorder";
	import DragHandle from "../components/DragHandle.svelte";
	import IconButton from "../components/IconButton.svelte";

	/** Committed membership + order; `onChange` fires once per completed edit. */
	interface FolderListProps {
		folders: readonly string[];
		onChange: (next: string[]) => void;
	}

	interface FolderDragItem extends Reorderable {
		id: string;
	}

	let { folders, onChange }: FolderListProps = $props();

	const zoneId = $props.id();
	const zoneType = `folder:${zoneId}`;
	const drag = createDragArming();
	const dragDisabled = $derived(drag.disabled);

	let listEl: HTMLOListElement | undefined = $state();

	function toItems(paths: readonly string[]): FolderDragItem[] {
		return paths.map((id) => ({ id }));
	}

	let preview = $state<FolderDragItem[] | null>(null);
	const items = $derived(preview ?? toItems(folders));

	const dropRecovery = createDropRecovery<FolderDragItem>();
	const folderLabel = (item: FolderDragItem) => item.id;

	function handleConsider(e: CustomEvent<DndEvent<FolderDragItem>>) {
		drag.markStarted();
		showDragPillOnStart(e, folderLabel);
		preview = dropRecovery.consider(e);
	}

	function handleFinalize(e: CustomEvent<DndEvent<FolderDragItem>>) {
		onChange(dropRecovery.finalize(e).map((item) => item.id));
		preview = null;
		if (e.detail.info.source === SOURCES.POINTER) {
			drag.reset();
		}
	}

	function moveFolder(id: string, delta: -1 | 1) {
		moveByKeyboard({
			listEl,
			items: toItems(folders),
			id,
			delta,
			describe: folderLabel,
			commit: (next) => onChange(next.map((item) => item.id)),
		});
	}

	function removeFolder(path: string) {
		onChange(folders.filter((folder) => folder !== path));
	}

	let startDrag = (event: PointerEvent) => {
		drag.startDrag(event);
	};
</script>

<ol
	bind:this={listEl}
	class="qa-folder-list"
	use:dndzone={baseDndOptions({
		items,
		dragDisabled,
		type: zoneType,
		resolveLabel: folderLabel,
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
