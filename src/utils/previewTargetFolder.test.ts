import { describe, expect, it } from "vitest";
import { likelyTargetFolderPath } from "./previewTargetFolder";
import type { TemplateFolderConfig } from "../types/choices/ITemplateChoice";

const folder = (
	overrides: Partial<TemplateFolderConfig> = {},
): TemplateFolderConfig => ({
	enabled: true,
	folders: ["Work"],
	chooseWhenCreatingNote: false,
	createInSameFolderAsActiveFile: false,
	chooseFromSubfolders: false,
	...overrides,
});

/**
 * What a PREVIEW may resolve {{FOLDER}} against. Anything this returns is
 * spliced into the previewed name verbatim, so every `undefined` below is a
 * case where naming a folder would have been a lie - and, because every
 * argument-bearing token carries a colon in its own syntax, usually a red
 * illegal-character row on a choice that works (#1590).
 */
describe("likelyTargetFolderPath", () => {
	it("names a single configured folder", () => {
		expect(likelyTargetFolderPath(folder())).toBe("Work");
	});

	it("declines when the run will open a folder chooser", () => {
		expect(likelyTargetFolderPath(folder({ folders: ["Work", "Home"] }))).toBeUndefined();
		expect(
			likelyTargetFolderPath(folder({ chooseWhenCreatingNote: true })),
		).toBeUndefined();
		expect(
			likelyTargetFolderPath(folder({ chooseFromSubfolders: true })),
		).toBeUndefined();
		expect(
			likelyTargetFolderPath(folder({ createInSameFolderAsActiveFile: true })),
		).toBeUndefined();
	});

	it("declines when QuickAdd's folder setting is off", () => {
		// Obsidian's own "default location for new notes" decides it.
		expect(likelyTargetFolderPath(folder({ enabled: false }))).toBeUndefined();
		expect(likelyTargetFolderPath(undefined)).toBeUndefined();
	});

	it("declines a folder holding format syntax, which the run resolves first", () => {
		expect(
			likelyTargetFolderPath(folder({ folders: ["Journal/{{DATE:YYYY-MM}}"] })),
		).toBeUndefined();
	});

	it("declines a folder holding an inline js quickadd fence", () => {
		// formatFolderPath EXECUTES it (replaceInlineJavascriptInString is
		// format()'s first pass), and the folder validator lets backticks
		// through - so the raw source would otherwise be spliced into the name,
		// which the preview must never do (#1558).
		expect(
			likelyTargetFolderPath(
				folder({ folders: ['```js quickadd\nreturn "Work";\n```'] }),
			),
		).toBeUndefined();
	});

	it("declines an empty or whitespace-only folder", () => {
		expect(likelyTargetFolderPath(folder({ folders: [""] }))).toBeUndefined();
		expect(likelyTargetFolderPath(folder({ folders: ["  "] }))).toBeUndefined();
	});
});
