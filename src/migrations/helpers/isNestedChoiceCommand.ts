import type { NestedChoiceCommand } from "src/types/macros/QuickCommands/NestedChoiceCommand";

export function isNestedChoiceCommand(
	command: unknown
): command is NestedChoiceCommand {
	if (
		command === null ||
		typeof command !== "object" ||
		!("choice" in command)
	) {
		return false;
	}

	return command.choice !== undefined;
}
