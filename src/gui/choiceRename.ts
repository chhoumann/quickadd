import type { App } from "obsidian";
import GenericInputPrompt from "./GenericInputPrompt/GenericInputPrompt";
import { log } from "src/logger/logManager";
import { isCancellationError, toError } from "../utils/errorUtils";
import type { ChoiceType } from "../types/choices/choiceType";
import { choiceNounCapitalized } from "../utils/choiceNoun";

/**
 * Header for the rename prompt: "Folder name" / "Choice name", so a rename right
 * after "New folder" does not ask for a choice name. See
 * {@link choiceNounCapitalized}.
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
		// A dismissal (Esc/Cancel) is expected, not an error. Ask the cancellation
		// contract rather than gating on `instanceof Error`: a dismissal is an
		// Error, so that gate would report every cancelled rename as a failure.
		if (isCancellationError(error)) return null;
		log.logError(toError(error, "Could not rename"));
		return null;
	}
}
