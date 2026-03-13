import type { TemplateFileExistsBehavior } from "src/template/fileExistsPolicy";
import { mapLegacyFileExistsModeToId } from "src/template/fileExistsPolicy";

export type LegacyTemplateChoice = {
	type?: string;
	incrementFileName?: boolean;
	setFileExistsBehavior?: boolean;
	fileExistsMode?: unknown;
	fileExistsBehavior?: TemplateFileExistsBehavior;
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

export function migrateFileExistsBehavior(
	choice: LegacyTemplateChoice,
): TemplateFileExistsBehavior {
	if (choice.fileExistsBehavior) {
		return choice.fileExistsBehavior;
	}

	if (choice.incrementFileName) {
		return { kind: "apply", mode: "increment" };
	}

	if (choice.setFileExistsBehavior) {
		return {
			kind: "apply",
			mode: mapLegacyFileExistsModeToId(choice.fileExistsMode) ?? "increment",
		};
	}

	return { kind: "prompt" };
}

export function normalizeTemplateChoice(choice: LegacyTemplateChoice): void {
	choice.fileExistsBehavior = migrateFileExistsBehavior(choice);
	delete choice.incrementFileName;
	delete choice.setFileExistsBehavior;
	delete choice.fileExistsMode;
}
