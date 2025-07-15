import { v4 as uuidv4 } from "uuid";
import type { IMacro } from "../types/macros/IMacro";

/**
 * Regenerates all IDs in a macro to prevent collisions after duplication
 */
export function regenerateIds(macro: IMacro): void {
	macro.id = uuidv4();
	macro.commands.forEach(command => {
		command.id = uuidv4();
	});
}
