import type { ChoiceType } from "../../types/choices/choiceType";
import type IChoice from "../../types/choices/IChoice";

/**
 * The single callback-prop bag threaded by reference through the recursive
 * choice list: ChoiceView -> ChoiceList -> (ChoiceListItem | MultiChoiceListItem)
 * -> nested ChoiceList -> ... MultiChoiceListItem overrides `onReorderChoices` for
 * its nested list so nested reorders bubble the whole root tree to the top.
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
	 * Toggle a folder's collapsed state through the top-level handler, which
	 * reassigns the root tree immutably: an in-place mutation is not reactive
	 * until the array has been proxied by a reassignment.
	 */
	onToggleCollapsed: (choice: IChoice) => void;
	/**
	 * Commit a folder's new children by id against ChoiceView's authoritative
	 * tree. In a cross-zone drag the root zone reassigns the tree first, so the
	 * folder zone's `choice` reference goes stale and would duplicate the row.
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
