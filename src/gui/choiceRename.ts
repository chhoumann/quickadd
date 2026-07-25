import type { App } from "obsidian";
import GenericInputPrompt from "./GenericInputPrompt/GenericInputPrompt";
import { log } from "src/logger/logManager";
import type { ChoiceType } from "../types/choices/choiceType";

/**
 * Header for the rename prompt. Folders are `Multi` choices internally, but the
 * UI calls them folders everywhere else ("New folder", "Add folder to {name}"),
 * so asking for a *choice* name right after the user asked for a *folder* is a
 * jolt on the very first interaction with the plugin (issue #1539).
 */
function renamePromptHeader(type?: ChoiceType): string {
	return type === "Multi" ? "Folder name" : "Choice name";
}

export async function promptRenameChoice(
	app: App,
	currentName: string,
	type?: ChoiceType,
): Promise<string | null> {
	try {
		const newName = await GenericInputPrompt.Prompt(
			app,
			renamePromptHeader(type),
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
