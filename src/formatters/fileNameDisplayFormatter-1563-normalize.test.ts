import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { FileNameDisplayFormatter } from "./fileNameDisplayFormatter";
import { normalizeGeneratedFilePath } from "../utils/generatedFilePath";

/**
 * Issue #1563. The run puts every generated name through
 * `normalizeGeneratedFilePath` on the way to the vault - TemplateChoiceEngine,
 * TemplateInsertEngine, templateNoteDiscovery, and the capture target via
 * captureTargetResolution all call it - so a preview that skips it asserts a
 * name the run will never create.
 *
 * Each case below pins the preview against the run's own normalizer rather than
 * against a hand-written string, so the two cannot drift apart.
 */
const mockApp = {
	workspace: { getActiveFile: () => null },
	vault: { getMarkdownFiles: () => [], getAbstractFileByPath: () => null },
	metadataCache: { getFileCache: () => null },
} as unknown as App;

function makeFormatter(): FileNameDisplayFormatter {
	return new FileNameDisplayFormatter(mockApp);
}

async function preview(input: string) {
	const formatter = makeFormatter();
	const out = await formatter.format(input);
	return { out, problems: formatter.diagnostics.list() };
}

describe("the file-name preview mirrors the run's name normalizer", () => {
	it.each([
		["a trailing dot", "Meeting notes."],
		["trailing spaces", "Meeting notes   "],
		["a backslash separator", String.raw`Notes\2026\Log`],
		["a line break", "First\nSecond"],
		["a run of line breaks with spaces around it", "First  \n\n  Second"],
		["a line separator character", "Line Separator"],
		["a leading line break", "\nName"],
		["a tab", "Tabbed\tName"],
	])("%s", async (_label, input) => {
		const { out, problems } = await preview(input);
		expect(out).toBe(normalizeGeneratedFilePath(input));
		expect(problems).toEqual([]);
	});

	it("normalizes what the tokens produced, not just what was typed", async () => {
		// The value placeholder is spliced in first; the normalizer then sees the
		// finished name, exactly as the run does.
		const { out } = await preview("Notes/{{VALUE:title}}.");
		expect(out).toBe("Notes/Example Title");
	});

	it("says so when the run would abort instead of quietly showing a name", async () => {
		const { out, problems } = await preview("Notes/../secret");
		expect(problems).toEqual([
			{
				severity: "error",
				kind: "path",
				message: 'File path cannot contain "." or ".." path segments.',
			},
		]);
		// Still shows the best-effort text: the diagnostic is what says it is
		// unusable, and blanking the row would hide the shape of the mistake.
		expect(out).toBe("Notes/../secret");
	});

	it("reports an empty interior segment", async () => {
		const { problems } = await preview("Notes//Log");
		expect(problems).toEqual([
			{
				severity: "error",
				kind: "path",
				message: "File path contains an empty path segment after formatting.",
			},
		]);
	});

	it("leaves a half-typed folder path alone while it is being typed", async () => {
		const { out, problems } = await preview("Notes/");
		expect(out).toBe("Notes/");
		expect(problems).toEqual([]);
	});

	it("leaves a capture target's special forms untouched", async () => {
		for (const target of [
			"property:status=done",
			"tag:#inbox",
			"Daily/2026-07-27.md",
		]) {
			const { out } = await preview(target);
			expect(out).toBe(target);
		}
	});

	it("does report the colon in a picker target, which the builder hides", async () => {
		// This formatter previews FILE NAMES. `property:x=y` and `tag:#inbox` are
		// capture-target syntax, not paths, and a colon in an actual name really
		// is fatal - so the rule is right and the SURFACE is what knows the
		// difference: CaptureTargetSetting.svelte renders no preview row at all
		// while the field holds recognised picker syntax
		// (`{#if !usesPickerTargetSyntax}`), and that gate is pinned by
		// CaptureTargetSetting-1578-picker-preview.test.ts.
		//
		// Teaching the formatter capture semantics would be the wrong layer: the
		// same class previews a Template choice's file name, where a literal
		// `property:x=y` IS a path and the colon IS the problem.
		const { problems } = await preview("property:status=done");
		expect(problems).toEqual([
			{
				severity: "error",
				kind: "path",
				message:
					'A file or folder name cannot contain ":", so this choice would fail at run time. Check your own text and tokens like {{TIME}}, which is HH:mm.',
			},
		]);
	});
});
