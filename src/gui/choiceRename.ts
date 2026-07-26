import type { App } from "obsidian";
import GenericInputPrompt from "./GenericInputPrompt/GenericInputPrompt";
import { log } from "src/logger/logManager";
import type { ChoiceType } from "../types/choices/choiceType";
import { choiceNounCapitalized } from "../utils/choiceNoun";

/**
 * Header for the rename prompt: "Folder name" / "Choice name". Asking for a
 * *choice* name right after the user asked for a *folder* is a jolt on the very
 * first interaction with the plugin (#1539). See {@link choiceNounCapitalized}.
 */
function renamePromptHeader(type?: ChoiceType): string {
	return `${choiceNounCapitalized(type)} name`;
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
