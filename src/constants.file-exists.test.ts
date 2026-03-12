import { describe, expect, it } from "vitest";
import {
	fileExistsAppendToBottom,
	fileExistsAppendToTop,
	fileExistsDoNothing,
	fileExistsDuplicateSuffix,
	fileExistsIncrement,
	fileExistsOverwriteFile,
	getFileExistsAutomationDescription,
	getFileExistsBehaviorModeDescription,
	getFileExistsSettingDescription,
} from "./constants";

describe("file exists helper copy", () => {
	it("returns concrete mode descriptions", () => {
		expect(getFileExistsBehaviorModeDescription(fileExistsAppendToBottom)).toBe(
			"Adds the template content to the end of the existing file.",
		);
		expect(getFileExistsBehaviorModeDescription(fileExistsAppendToTop)).toBe(
			"Adds the template content to the beginning of the existing file.",
		);
		expect(getFileExistsBehaviorModeDescription(fileExistsOverwriteFile)).toBe(
			"Replaces the existing file content with the template.",
		);
		expect(getFileExistsBehaviorModeDescription(fileExistsIncrement)).toBe(
			"Changes trailing digits only. Example: Note009.md -> Note010.md.",
		);
		expect(
			getFileExistsBehaviorModeDescription(fileExistsDuplicateSuffix),
		).toBe(
			"Keeps the original name and adds a duplicate marker. Example: tt0780504.md -> tt0780504 (1).md.",
		);
		expect(getFileExistsBehaviorModeDescription(fileExistsDoNothing)).toBe(
			"Leaves the file unchanged and opens the existing file.",
		);
	});

	it("returns distinct copy for automatic and prompted behavior", () => {
		expect(getFileExistsAutomationDescription(true)).toBe(
			"QuickAdd applies the selected behavior without asking.",
		);
		expect(getFileExistsAutomationDescription(false)).toBe(
			"QuickAdd prompts you each time the target file already exists.",
		);
	});

	it("combines automatic behavior and selected mode into one setting description", () => {
		expect(getFileExistsSettingDescription(false, fileExistsDuplicateSuffix)).toBe(
			"QuickAdd prompts you each time the target file already exists.",
		);
		expect(getFileExistsSettingDescription(true, fileExistsDuplicateSuffix)).toBe(
			"QuickAdd applies the selected behavior without asking. Keeps the original name and adds a duplicate marker. Example: tt0780504.md -> tt0780504 (1).md.",
		);
	});
});
