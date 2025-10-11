/**
 * Initializes default values for user script settings.
 *
 * This function populates the command's settings object with default values
 * from the user script's settings configuration for any settings that are
 * currently undefined.
 *
 * @param commandSettings - The command's settings object to populate
 * @param userScriptSettings - The user script's settings configuration
 */
export function initializeUserScriptSettings(
	commandSettings: { [key: string]: unknown },
	userScriptSettings: {
		[key: string]: unknown;
		options?: {
			[key: string]: {
				defaultValue?: unknown;
			};
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

		if (valueIsNotSetAlready && defaultValueAvailable) {
			commandSettings[setting] =
				userScriptSettings.options[setting].defaultValue;
		}
	}
}
