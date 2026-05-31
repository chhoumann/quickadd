import type { ChoiceType } from "../../types/choices/choiceType";
import type IChoice from "../../types/choices/IChoice";

/**
 * The single callback-prop bag threaded (by reference) through the recursive
 * choiceList cluster: ChoiceView -> ChoiceList -> (ChoiceListItem |
 * MultiChoiceListItem) -> nested ChoiceList -> ...
 *
 * Replaces the Svelte 4 `createEventDispatcher` + bare `on:event` forwarding.
 * Payloads are flattened (the choice itself, not `{ choice }`). MultiChoiceListItem
 * overrides `onReorderChoices` for its nested list so nested reorders bubble the
 * whole root tree up to the top-level handler.
 */
export interface ChoiceListActions {
	onDeleteChoice: (choice: IChoice) => void;
	onConfigureChoice: (choice: IChoice) => void;
	onToggleCommand: (choice: IChoice) => void;
	onDuplicateChoice: (choice: IChoice) => void;
	onRenameChoice: (choice: IChoice) => void;
	onMoveChoice: (choice: IChoice, targetId: string) => void;
	onReorderChoices: (choices: IChoice[]) => void;
	/**
	 * Toggle a Multi (folder)'s collapsed state. Routed to the top-level ChoiceView
	 * handler, which reassigns the root tree immutably (by id, any depth) — an
	 * in-place `choice.collapsed = …` mutation isn't reactive until the array has
	 * been proxied by a reassignment, so clicking a folder wouldn't open/close it on
	 * first render. Persists like the other tree edits.
	 */
	onToggleCollapsed: (choice: IChoice) => void;
	/**
	 * Commit a folder's new children by id against ChoiceView's authoritative tree.
	 * A nested reorder/drag uses this instead of mutating a `choice` prop reference:
	 * within a synchronous cross-zone drag finalize the root zone reassigns the tree
	 * first, so the folder zone's `choice` goes stale (points at a folder no longer
	 * in the live tree) — by-id keeps the edit landing on the real node, fixing the
	 * root<->folder drag duplication.
	 */
	onCommitFolder: (folderId: string, children: IChoice[]) => void;
	/**
	 * Add a new choice. `targetFolderId` inserts it into that folder (root when
	 * omitted); `skipConfigure` suppresses the post-add builder. Threaded from the
	 * top-level ChoiceView handler so it persists the whole root tree (the same
	 * invariant as `onReorderChoices`/`rootReorder`), never an ancestor override.
	 */
	onAddChoice: (
		name: string,
		type: ChoiceType,
		targetFolderId?: string,
		skipConfigure?: boolean,
	) => void;
}
