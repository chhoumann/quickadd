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
