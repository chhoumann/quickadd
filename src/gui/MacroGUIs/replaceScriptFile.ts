import type { App } from "obsidian";
import { Notice } from "obsidian";
import type { IUserScript } from "../../types/macros/IUserScript";
import { clearUserScriptSecretsFromCommand } from "../../utils/userScriptSecrets";

/**
 * Point a script step at another file. The old script's settings do not carry
 * over: the new script need not declare them, and a stored secret must never
 * reach a script it was not entered for. The step takes the picked file's name,
 * as a newly added script does; a `::member` suffix is dropped with the old
 * file. Returns false, after a notice, when the stored secrets could not be
 * cleared; the step is then left as it was.
 */
export async function replaceScriptFile(
	app: App,
	command: IUserScript,
	picked: { name: string; path: string },
): Promise<boolean> {
	if (!(await clearUserScriptSecretsFromCommand(app, command))) {
		new Notice("Could not clear the script's secrets. The file was not changed.");
		return false;
	}
	command.name = picked.name;
	command.path = picked.path;
	command.settings = {};
	return true;
}
