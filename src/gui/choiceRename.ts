import type { App } from "obsidian";
import GenericInputPrompt from "./GenericInputPrompt/GenericInputPrompt";

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
	} catch {
		return null;
	}
}
