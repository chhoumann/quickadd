import { log } from "../logger/logManager";
import { CommandType } from "../types/macros/CommandType";
import type IChoice from "../types/choices/IChoice";
import type { ICommand } from "../types/macros/ICommand";
import type { IChoiceCommand } from "../types/macros/IChoiceCommand";
import type { INestedChoiceCommand } from "../types/macros/QuickCommands/INestedChoiceCommand";
import type { IObsidianCommand } from "../types/macros/IObsidianCommand";

/** Templater's "Replace templates in the active file" command. */
export const TEMPLATER_REPLACE_COMMAND_ID = "templater-obsidian:replace-in-file-templater";

const shown = new Set<string>();

/** Show a deprecation warning once per key for this Obsidian session. */
export function warnDeprecatedOnce(key: string, message: string): void {
	if (shown.has(key)) return;
	shown.add(key);
	log.logWarning(message);
}

function stepChoice(command: ICommand, resolveChoice: (id: string) => IChoice | null): IChoice | null {
	if (command.type === CommandType.NestedChoice) return (command as INestedChoiceCommand).choice ?? null;
	if (command.type === CommandType.Choice) return resolveChoice((command as IChoiceCommand).choiceId);
	return null;
}

/**
 * The name of the Template or Capture step that `command` re-runs Templater
 * after, or null. A macro that runs Templater's "Replace templates in the active
 * file" right after one of those runs its templates a second time; QuickAdd
 * already ran them. `previous` is the macro's last step before `command` that
 * was not a Wait.
 */
export function templaterRerunAfter(
	previous: ICommand | undefined,
	command: ICommand,
	resolveChoice: (id: string) => IChoice | null,
): string | null {
	if (!previous || command.type !== CommandType.Obsidian) return null;
	if ((command as IObsidianCommand).commandId !== TEMPLATER_REPLACE_COMMAND_ID) return null;
	const choice = stepChoice(previous, resolveChoice);
	return choice && (choice.type === "Template" || choice.type === "Capture") ? choice.name : null;
}
