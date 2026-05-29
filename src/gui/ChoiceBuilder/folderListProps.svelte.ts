/**
 * Props for FolderList, shared with its imperative host (templateChoiceBuilder).
 * The host owns a $state-backed instance and mutates `folders` to push add/remove
 * updates into the mounted component — replacing FolderList's old exported
 * `updateFolders()` bridge (which reassigned a prop, illegal under runes).
 */
export interface FolderListProps {
	folders: string[];
	deleteFolder: (folder: string) => void;
}

export function createFolderListProps(initial: FolderListProps): FolderListProps {
	const props = $state(initial);
	return props;
}
