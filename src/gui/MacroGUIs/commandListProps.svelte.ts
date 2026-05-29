import type { App } from "obsidian";
import type QuickAdd from "../../main";
import type { ICommand } from "../../types/macros/ICommand";
import type { IConditionalCommand } from "../../types/macros/Conditional/IConditionalCommand";

/**
 * Props for CommandList, shared between the component and its imperative host.
 *
 * `commands` is the host->child channel: the host (CommandSequenceEditor) owns a
 * $state-backed instance of this object (see createCommandListProps) and mutates
 * `commands` to push add/delete/configure results into the mounted component —
 * replacing the old exported `updateCommandList()` bridge. The child reports its
 * own edits (reorder, per-command update) back up via the `saveCommands` callback.
 */
export interface CommandListProps {
	commands: ICommand[];
	app: App;
	plugin: QuickAdd;
	deleteCommand: (commandId: string) => void | Promise<void>;
	saveCommands: (commands: ICommand[]) => void;
	onConfigureCondition?: (command: IConditionalCommand) => void;
	onEditThenBranch?: (command: IConditionalCommand) => void;
	onEditElseBranch?: (command: IConditionalCommand) => void;
}

/**
 * Create a $state-backed props object to pass to `mount(CommandList, ...)`.
 * Mutating `.commands` on the returned object re-renders the mounted component
 * (the documented way to feed reactive props to an imperatively-mounted Svelte 5
 * component). Lives in a `.svelte.ts` file so `$state` is available.
 */
export function createCommandListProps(initial: CommandListProps): CommandListProps {
	// $state must initialize a variable declaration (not be returned directly).
	const props = $state(initial);
	return props;
}
