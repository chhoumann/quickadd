import type ICaptureChoice from "../../types/choices/ICaptureChoice";
import type IMacroChoice from "../../types/choices/IMacroChoice";
import type ITemplateChoice from "../../types/choices/ITemplateChoice";
import { CaptureChoice } from "../../types/choices/CaptureChoice";
import { MacroChoice } from "../../types/choices/MacroChoice";
import { TemplateChoice } from "../../types/choices/TemplateChoice";
import type { DateOrigin } from "../../types/dateOrigin";
import { dateOriginToPreset } from "../../types/dateOriginPresets";
import { normalizeAppendLinkOptions } from "../../types/linkPlacement";
import { actionInRibbon } from "./actionRibbon";
import { deriveFolderMode, isSingleFolder } from "./folderMode";

/** A choice whose builder keeps settings behind More settings. */
export type MoreSettingsChoice = ITemplateChoice | ICaptureChoice | IMacroChoice;

/**
 * The choice fields set behind a builder's More settings.
 * A setting shown only under another one (where to open the file, what to do
 * with a picked existing note) is left out: the one it hangs under counts.
 */
export const MORE_SETTINGS_FIELDS = {
	Template: [
		"fileExistsBehavior",
		"discoverExistingNotesBeforeCreate",
		"appendLink",
		"copyLinkToClipboard",
		"openFile",
		"dateOrigin",
		"onePageInput",
		"command",
		"pickDayCommand",
	],
	Capture: [
		"createFileIfItDoesntExist",
		"appendLink",
		"copyLinkToClipboard",
		"eachLine",
		"openFile",
		"useSelectionAsCaptureValue",
		"templater",
		"dateOrigin",
		"onePageInput",
		"command",
		"pickDayCommand",
	],
	// Not the icon: every preset sets one, and the lede shows it anyway.
	Macro: ["onePageInput", "dateOrigin", "runOnStartup", "command", "pickDayCommand"],
} as const satisfies {
	Template: (keyof ITemplateChoice)[];
	Capture: (keyof ICaptureChoice)[];
	Macro: (keyof IMacroChoice)[];
};

const FRESH: Record<keyof typeof MORE_SETTINGS_FIELDS, () => Record<string, unknown>> = {
	Template: () => ({ ...new TemplateChoice("") }),
	Capture: () => ({ ...new CaptureChoice("") }),
	Macro: () => ({ ...new MacroChoice("") }),
};

/**
 * Whether any setting behind More settings differs from a new choice of the
 * type, so the builder opens with them showing.
 */
export function hasNonDefaultMoreSettings(choice: MoreSettingsChoice): boolean {
	if (actionInRibbon(choice.id) === true) return true;
	if (choice.type === "Template") {
		const folder = (choice as ITemplateChoice).folder;
		if (!isSingleFolder(folder)) return true;
		if (deriveFolderMode(folder) === "specified" && folder.chooseFromSubfolders) return true;
	}
	const type = choice.type === "Template" || choice.type === "Macro" ? choice.type : "Capture";
	const fresh = FRESH[type]();
	const fields: readonly string[] = MORE_SETTINGS_FIELDS[type];
	const values = choice as unknown as Record<string, unknown>;
	return fields.some((field) => !sameSetting(field, values[field], fresh[field]));
}

function sameSetting(field: string, value: unknown, fresh: unknown): boolean {
	// A field an older version did not save reads as its default.
	if (value === undefined) return true;
	switch (field) {
		// Link options stay saved when linking is turned off.
		case "appendLink":
			return normalizeAppendLinkOptions(value as boolean).enabled === normalizeAppendLinkOptions(fresh as boolean).enabled;
		// Unset follows the global setting; false ignores the selection.
		case "useSelectionAsCaptureValue":
			return value === fresh;
		case "templater":
			return (value as ICaptureChoice["templater"])?.afterCapture !== "wholeFile";
		case "dateOrigin":
			return dateOriginToPreset(value as DateOrigin) === dateOriginToPreset(fresh as DateOrigin | undefined);
		default:
			return same(value, fresh);
	}
}

/** Deep equality where unset, null and false are one value: a toggle turned off is off. */
function same(a: unknown, b: unknown): boolean {
	if (isRecord(a) && isRecord(b)) {
		const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
		return [...keys].every((key) => same(a[key], b[key]));
	}
	if (Array.isArray(a) || Array.isArray(b)) {
		return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => same(item, b[index]));
	}
	return a === b || (isOff(a) && isOff(b));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOff(value: unknown): boolean {
	return value === undefined || value === null || value === false;
}

/** Choices whose More settings were opened, kept open for the session. */
const opened = new Map<string, boolean>();

export function moreSettingsOpen(choice: MoreSettingsChoice): boolean {
	return opened.get(choice.id) ?? hasNonDefaultMoreSettings(choice);
}

export function setMoreSettingsOpen(choiceId: string, open: boolean): void {
	opened.set(choiceId, open);
}
