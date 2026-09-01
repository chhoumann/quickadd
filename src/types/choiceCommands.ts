import type { DateOrigin } from "./dateOrigin";
import { dateOriginToPreset } from "./dateOriginPresets";

export const COMMAND_SETTING_NAME = "Add to command palette";
export const COMMAND_SETTING_DESC =
	"Run this choice from the command palette or a hotkey.";

export const PICK_DAY_SETTING_DESC =
	"A second command that asks which day first. Your hotkey for the main command still uses Which day.";

export function pickDaySettingName(choiceName: string): string {
	return `Also add "${pickDayCommandName(choiceName)}"`;
}

export function choiceCommandId(choiceId: string): string {
	return `choice:${choiceId}`;
}

export function pickDayCommandId(choiceId: string): string {
	return `${choiceCommandId(choiceId)}:pick-day`;
}

export function pickDayCommandName(choiceName: string): string {
	return `${choiceName} (pick a day)`;
}

/**
 * The pick-a-day toggle only makes sense when the main command does not
 * already prompt, so Ask each time hides it.
 */
export function canOfferPickDayCommand(origin: DateOrigin | undefined): boolean {
	return dateOriginToPreset(origin) !== "ask";
}

export function shouldRegisterPickDayCommand(input: {
	origin?: DateOrigin;
	enabled?: boolean;
}): boolean {
	return Boolean(input.enabled) && canOfferPickDayCommand(input.origin);
}
