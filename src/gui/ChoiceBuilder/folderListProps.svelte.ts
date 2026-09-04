/**
 * Props for the template-choice folder path list.
 * `folders` is committed membership + order; `onChange` fires once per completed
 * edit (trash, drop finalize, ArrowUp/Down) and never from consider.
 */
export interface FolderListProps {
	folders: readonly string[];
	onChange: (next: string[]) => void;
}
