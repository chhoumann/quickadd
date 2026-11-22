import {
	isSecretUserScriptOption,
	type UserScriptOptionDefinition,
} from "./userScriptSecrets";

/** Fills the command's settings with the user script's defaults for any that are undefined. */
export function initializeUserScriptSettings(
	commandSettings: { [key: string]: unknown },
	userScriptSettings: {
		[key: string]: unknown;
		options?: {
			[key: string]: UserScriptOptionDefinition;
		};
	}
): void {
	if (!userScriptSettings.options) {
		return;
	}

	for (const setting in userScriptSettings.options) {
		const valueIsNotSetAlready = commandSettings[setting] === undefined;
		const defaultValueAvailable =
			"defaultValue" in userScriptSettings.options[setting] &&
			userScriptSettings.options[setting].defaultValue !== undefined;

		if (
			valueIsNotSetAlready &&
			defaultValueAvailable &&
			!isSecretUserScriptOption(userScriptSettings.options[setting])
		) {
			commandSettings[setting] =
				userScriptSettings.options[setting].defaultValue;
		}
	}
}
