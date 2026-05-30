<script lang="ts">
	import { Menu } from "obsidian";
	import type { ChoiceType } from "../../types/choices/choiceType";
	import ObsidianIcon from "../components/ObsidianIcon.svelte";
	import { DOER_CHOICE_TYPES, defaultChoiceName } from "./choiceTypeMeta";

	let {
		onAddChoice,
		targetFolderId = undefined,
		compact = false,
	}: {
		/**
		 * Add a choice. `targetFolderId` inserts it into that folder (root when
		 * omitted); `skipConfigure` suppresses the post-add builder (used by
		 * Alt-click and always for folders).
		 */
		onAddChoice: (
			name: string,
			type: ChoiceType,
			targetFolderId?: string,
			skipConfigure?: boolean,
		) => void;
		/** When set, both actions add into this folder. */
		targetFolderId?: string;
		/** Denser styling for the per-folder affordance. */
		compact?: boolean;
	} = $props();

	let menuOpen = $state(false);

	function openNewChoiceMenu(evt: MouseEvent) {
		const menu = new Menu();
		for (const meta of DOER_CHOICE_TYPES) {
			menu.addItem((item) =>
				item
					.setTitle(`${meta.label} — ${meta.description}`)
					.setIcon(meta.iconId)
					.onClick((clickEvt) => {
						// Alt/⌥ scaffolds without opening the builder (batch path).
						const skip =
							(clickEvt as MouseEvent | KeyboardEvent).altKey === true;
						onAddChoice(
							defaultChoiceName(meta.type),
							meta.type,
							targetFolderId,
							skip,
						);
					}),
			);
		}
		// Anchor the menu under the trigger button. Using the button rect (rather
		// than the event coordinates) makes this work for keyboard activation too
		// and is robust to Svelte 5's event delegation (currentTarget is the
		// delegated root, not the button).
		// Reflect open state for assistive tech (aria-expanded on the trigger).
		menuOpen = true;
		menu.onHide(() => {
			menuOpen = false;
		});

		const trigger = (evt.target as HTMLElement | null)?.closest("button");
		if (trigger) {
			const rect = trigger.getBoundingClientRect();
			menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
		} else {
			menu.showAtMouseEvent(evt);
		}
	}

	function addFolder() {
		// Folders never open a builder — a fresh folder is immediately useful.
		onAddChoice(defaultChoiceName("Multi"), "Multi", targetFolderId, true);
	}

	// WCAG 2.5.3 (Label in Name): the accessible name must contain the visible
	// text ("New choice" / "New folder") so voice-control activation matches.
	const newChoiceLabel = $derived(
		targetFolderId ? "New choice in this folder" : "New choice",
	);
	const newFolderLabel = $derived(
		targetFolderId ? "New folder in this folder" : "New folder",
	);
</script>

<div class="qaAddChoiceControls" class:compact>
	<button
		type="button"
		class="qaNewChoiceBtn"
		class:mod-cta={!compact}
		aria-haspopup="menu"
		aria-expanded={menuOpen}
		aria-label={newChoiceLabel}
		onclick={openNewChoiceMenu}
	>
		<ObsidianIcon iconId="plus" size={14} />
		<span>New choice</span>
		<ObsidianIcon iconId="chevron-down" size={12} />
	</button>
	<button
		type="button"
		class="qaNewFolderBtn"
		aria-label={newFolderLabel}
		onclick={addFolder}
	>
		<ObsidianIcon iconId="folder-plus" size={14} />
		<span>New folder</span>
	</button>
</div>

<style>
	.qaAddChoiceControls {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
	}

	.qaAddChoiceControls button {
		display: inline-flex;
		align-items: center;
		gap: 0.35em;
	}

	/* The chevron sits tighter to the label than the leading plus. */
	.qaNewChoiceBtn :global(svg:last-child) {
		margin-left: -0.1em;
		opacity: 0.85;
	}

	.qaAddChoiceControls.compact {
		gap: 0.35rem;
	}

	/* Per-folder ("compact") controls are secondary to the global primary action,
	   so they're quieter — ghost styling, smaller, muted — and don't compete with
	   the top-bar "New choice" CTA, especially when repeated in nested folders. */
	.qaAddChoiceControls.compact button {
		font-size: var(--font-ui-smaller);
		padding: var(--size-4-1) var(--size-4-2);
		background: transparent;
		box-shadow: none;
		color: var(--text-muted);
	}

	.qaAddChoiceControls.compact button:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	@media (max-width: 800px) {
		.qaAddChoiceControls:not(.compact) {
			flex-direction: column;
			align-items: stretch;
		}
	}
</style>
