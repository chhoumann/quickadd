<script lang="ts">
	import { Menu } from "obsidian";
	import type { ChoiceType } from "../../types/choices/choiceType";
	import ObsidianIcon from "../components/ObsidianIcon.svelte";
	import { DOER_CHOICE_TYPES, defaultChoiceName } from "./choiceTypeMeta";

	let {
		onAddChoice,
		targetFolderId = undefined,
		targetFolderName = undefined,
		compact = false,
		fill = false,
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
		/** Folder name, used in the per-folder tooltip ("Add choice to {name}"). */
		targetFolderName?: string;
		/** Quiet, text-link styling for the per-folder affordance. */
		compact?: boolean;
		/** Stretch the two buttons to fill the container (touch-friendly on mobile). */
		fill?: boolean;
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

	// Per-folder (compact) controls read as "Add choice"/"Add folder" text links;
	// the global controls read as "New choice"/"New folder" buttons.
	const newChoiceText = $derived(compact ? "Add choice" : "New choice");
	const newFolderText = $derived(compact ? "Add folder" : "New folder");

	// WCAG 2.5.3 (Label in Name): the accessible name must CONTAIN the visible
	// text. Per folder we name the target ("Add choice to {folder}"), which keeps
	// "Add choice" as a substring.
	const newChoiceLabel = $derived(
		targetFolderName ? `Add choice to ${targetFolderName}` : newChoiceText,
	);
	const newFolderLabel = $derived(
		targetFolderName ? `Add folder to ${targetFolderName}` : newFolderText,
	);
</script>

<!-- Order: secondary "New folder" first, primary "New choice" last so the primary
     CTA sits in the terminal (rightmost) position. -->
<div class="qaAddChoiceControls" class:compact class:fill={fill && !compact}>
	<button
		type="button"
		class="qaNewFolderBtn"
		aria-label={newFolderLabel}
		title={compact ? newFolderLabel : undefined}
		onclick={addFolder}
	>
		<ObsidianIcon iconId="folder-plus" size={14} />
		<span>{newFolderText}</span>
	</button>
	<button
		type="button"
		class="qaNewChoiceBtn"
		class:mod-cta={!compact}
		aria-haspopup="menu"
		aria-expanded={menuOpen}
		aria-label={newChoiceLabel}
		title={compact ? newChoiceLabel : undefined}
		onclick={openNewChoiceMenu}
	>
		<ObsidianIcon iconId="plus" size={14} />
		<span>{newChoiceText}</span>
		{#if !compact}
			<ObsidianIcon iconId="chevron-down" size={12} />
		{/if}
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

	/* Per-folder ("compact") controls render as quiet, clickable text links — not
	   filled buttons — so they read as "add inside this folder" affordances and
	   don't compete with the global primary CTA, especially when repeated across
	   nested folders. */
	.qaAddChoiceControls.compact {
		gap: 1rem;
	}

	.qaAddChoiceControls.compact button {
		font-size: var(--font-ui-smaller);
		padding: 2px 0;
		gap: 0.25em;
		background: transparent;
		border: none;
		box-shadow: none;
		color: var(--text-muted);
	}

	.qaAddChoiceControls.compact button:hover {
		color: var(--text-accent);
		text-decoration: underline;
	}

	/* Mobile/touch: stretch so the two buttons fill the bar width instead of
	   cramming to the right. Driven by `fill` (Platform.isMobile from the bottom
	   bar) because viewport media queries don't fire under desktop mobile-emulation. */
	.qaAddChoiceControls.fill {
		flex: 1;
	}

	.qaAddChoiceControls.fill button {
		flex: 1;
		justify-content: center;
	}

	@media (max-width: 800px) {
		.qaAddChoiceControls:not(.compact) {
			flex-direction: column;
			align-items: stretch;
		}
	}
</style>
