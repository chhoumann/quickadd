import type { App } from "obsidian";
import { Notice } from "obsidian";
import type { IUserScript } from "../../types/macros/IUserScript";
import { clearUserScriptSecretsFromCommand } from "../../utils/userScriptSecrets";

/**
 * Point a script step at another file. The old script's settings do not carry
 * over: the new script need not declare them, and a stored secret must never
 * reach a script it was not entered for. The step takes the picked file's name,
 * as a newly added script does; a `::member` suffix is dropped with the old
 * file. The stored secrets are removed first; if that fails partway, the
 * references are dropped all the same, since a reference that no longer
 * resolves is worse than an entry left behind in secret storage.
 */
export async function replaceScriptFile(
	app: App,
	command: IUserScript,
	picked: { name: string; path: string },
): Promise<void> {
	if (!(await clearUserScriptSecretsFromCommand(app, command))) {
		new Notice("QuickAdd: Not all of the script's stored secrets could be removed from secret storage.");
	}
	command.name = picked.name;
	command.path = picked.path;
	command.settings = {};
}
