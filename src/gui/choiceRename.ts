import type { App } from "obsidian";
import GenericInputPrompt from "./GenericInputPrompt/GenericInputPrompt";
import { log } from "src/logger/logManager";

export async function promptRenameChoice(
	app: App,
	currentName: string,
): Promise<string | null> {
	try {
		const newName = await GenericInputPrompt.Prompt(
			app,
			"Choice name",
			undefined,
			currentName,
		);
		const trimmed = newName.trim();
		if (!trimmed || trimmed === currentName) return null;
		return trimmed;
	} catch (error) {
		// GenericInputPrompt rejects with a string ("No input given.") when the
		// user cancels (Esc/Cancel) — that is expected, not an error. Surface only
		// genuine failures (Error instances) instead of swallowing them silently.
		if (error instanceof Error) log.logError(error);
		return null;
	}
}
