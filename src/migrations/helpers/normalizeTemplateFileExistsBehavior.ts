import type { TemplateFileExistsBehavior } from "src/template/fileExistsPolicy";
import { mapLegacyFileExistsModeToId } from "src/template/fileExistsPolicy";

type LegacyTemplateChoice = {
	type?: string;
	incrementFileName?: boolean;
	setFileExistsBehavior?: boolean;
	fileExistsMode?: unknown;
	fileExistsBehavior?: TemplateFileExistsBehavior;
	openFile?: boolean;
};

export function isTemplateChoice(
	choice: unknown,
): choice is LegacyTemplateChoice {
	return (
		typeof choice === "object" &&
		choice !== null &&
		"type" in choice &&
		(choice as { type?: string }).type === "Template"
	);
}

function migrateFileExistsBehavior(
	choice: LegacyTemplateChoice,
): TemplateFileExistsBehavior {
	if (choice.fileExistsBehavior) {
		// 2.33's leaveUnchanged opened the kept note only when Open was on, so it
		// splits into the two keep modes with the same behavior.
		if (
			choice.fileExistsBehavior.kind === "apply" &&
			(choice.fileExistsBehavior.mode as string) === "leaveUnchanged"
		) {
			return {
				kind: "apply",
				mode: choice.openFile ? "doNothing" : "leaveClosed",
			};
		}
		return choice.fileExistsBehavior;
	}

	if (choice.setFileExistsBehavior) {
		return {
			kind: "apply",
			mode: mapLegacyFileExistsModeToId(choice.fileExistsMode) ?? "increment",
		};
	}

	if (choice.incrementFileName) {
		return { kind: "apply", mode: "increment" };
	}

	return { kind: "prompt" };
}

export function normalizeTemplateChoice(choice: LegacyTemplateChoice): void {
	choice.fileExistsBehavior = migrateFileExistsBehavior(choice);
	delete choice.incrementFileName;
	delete choice.setFileExistsBehavior;
	delete choice.fileExistsMode;
}
