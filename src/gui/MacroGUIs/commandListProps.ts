import type { App } from "obsidian";
import type { ChoiceBuilderPlugin } from "../../types/pluginContext";
import type { ICommand } from "../../types/macros/ICommand";
import type { IConditionalCommand } from "../../types/macros/Conditional/IConditionalCommand";
import type { Plain } from "../svelte/persist.svelte";

/**
 * Props for CommandList, shared between the component and its imperative host.
 *
 * `commands` is the host->child channel: the host (CommandSequenceEditor) owns a
 * $state-backed instance of this object (see reactiveProps) and mutates
 * `commands` to push add/delete/configure results into the mounted component.
 * The child reports its own edits back up via the `saveCommands` callback.
 */
export interface CommandListProps {
	commands: ICommand[];
	app: App;
	plugin: ChoiceBuilderPlugin;
	deleteCommand: (commandId: string) => void | Promise<void>;
	// Accepts only Plain<ICommand[]> (from snapshot()) so a live $state proxy can't
	// be persisted without snapshotting — see persist.svelte.ts.
	saveCommands: (commands: Plain<ICommand[]>) => void;
	// Return true when the command was changed so CommandList persists it (the
	// handler mutates the command; CommandList snapshots+saves — see CommandList.svelte).
	onConfigureCondition?: (command: IConditionalCommand) => boolean | Promise<boolean>;
	// Branch pages mutate the command when left, then call onEdited.
	onEditThenBranch?: (command: IConditionalCommand, onEdited: () => void) => void;
	onEditElseBranch?: (command: IConditionalCommand, onEdited: () => void) => void;
}
