import type { App } from "obsidian";
import type { SettingsSaver } from "../types/pluginContext";
import type { IUserScript } from "../types/macros/IUserScript";
import {
	migrateUserScriptSecretSettings,
	resolveUserScriptSettings,
	type UserScriptSettingsDefinition,
} from "../utils/userScriptSecrets";

export async function resolveScriptSettings(
	app: App,
	plugin: Partial<SettingsSaver>,
	command: IUserScript,
	definition: UserScriptSettingsDefinition | undefined,
) {
	if (await migrateUserScriptSecretSettings(app, command, definition)) {
		await plugin.saveSettings?.();
	}
	return resolveUserScriptSettings(app, command, definition);
}
