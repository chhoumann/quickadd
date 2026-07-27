import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { TFile } from "obsidian";
import { FileNameDisplayFormatter } from "./fileNameDisplayFormatter";
import type QuickAdd from "../main";

/**
 * The file-name preview's token vocabulary, pinned against the REAL formatter.
 *
 * This file used to define a `TestFileNameDisplayFormatter` class with a
 * hand-written `format()` of a dozen regex replaces and assert that those
 * regexes did what they said - eleven green tests that never imported
 * `FileNameDisplayFormatter` and could not fail for any change to it (issue
 * #1580). It had also drifted into asserting behaviour the plugin cannot
 * produce: `{{TEMPLATE:daily-note}}` was pinned to a fabricated
 * `[daily-note template content...]` placeholder that #1560 deleted and #1563
 * replaced with a real inert read.
 *
 * Every case below constructs the real class. The sibling files cover the
 * behaviours in depth - `fileNameDisplayFormatter.audit-cleanup.test.ts` (VDATE
 * hints), `fileNameDisplayFormatter-1563-normalize.test.ts` (the run's name
 * normalizer), `fileNameDisplayFormatter-1563-template.test.ts` ({{TEMPLATE:}}
 * inertness) - so this one is deliberately the broad, shallow pass: one case per
 * token, so that deleting a pass from `formatInternal` fails a test.
 */

const templates: Record<string, string> = {
	"Templates/Daily.md": "Daily body\n",
	// The run resolves {{title}} inside an included body (child engine ->
	// formatFileContent), so this previews as "note", not as an error (#1588).
	"Templates/Titled.md": "{{title}} note\n",
};

const activeFile = {
	basename: "example",
	path: "test/example.md",
	parent: { path: "test" },
};

function makeApp(): App {
	return {
		workspace: { getActiveFile: () => activeFile },
		vault: {
			getMarkdownFiles: () => [
				Object.assign(new TFile(), {
					path: "Templates/Daily.md",
					extension: "md",
					basename: "Daily",
					parent: { path: "Templates" },
				}),
			],
			getAbstractFileByPath: (path: string) =>
				path in templates
					? Object.assign(new TFile(), {
							path,
							extension: "md",
							basename: path.replace(/\.md$/, ""),
						})
					: null,
			cachedRead: async (file: { path: string }) => templates[file.path],
		},
		metadataCache: { getFileCache: () => null, getAllPropertyInfos: () => ({}) },
	} as unknown as App;
}

const plugin = {
	settings: { globalVariables: { prefix: "Draft " }, choices: [] },
	getTemplateFiles: () => [],
} as unknown as QuickAdd;

function makeFormatter(): FileNameDisplayFormatter {
	const formatter = new FileNameDisplayFormatter(makeApp(), plugin);
	// Every real caller sets this; leaving it unset makes {{FOLDER}} collapse to
	// an empty path segment (FormatPreviewField passes the choice's folder, or a
	// "Folder/Name" placeholder).
	formatter.setTargetFolderPath("Folder/Name");
	return formatter;
}

async function preview(input: string) {
	const formatter = makeFormatter();
	const text = await formatter.format(input);
	return { text, diagnostics: formatter.diagnostics.list() };
}

describe("FileNameDisplayFormatter resolves the tokens a file name can hold", () => {
	it("previews {{DATE}}", async () => {
		// Date FORMAT is covered by the date helpers' own tests; what matters here
		// is that the pass runs at all and leaves no token behind.
		const { text } = await preview("{{DATE}} - {{VALUE}}");
		expect(text).toMatch(/^\d{4}-\d{2}-\d{2} - user input$/);
	});

	it("previews named {{VALUE:x}} prompts with per-name examples", async () => {
		const { text } = await preview("{{VALUE:title}} - {{VALUE:project}}");
		expect(text).toBe("Example Title - Project Alpha");
	});

	it("previews {{MACRO:x}} without running the macro engine", async () => {
		const { text } = await preview("{{MACRO:clipboard}} - {{MACRO:uuid}}");
		expect(text).toBe("clipboard_content - unique_id");
	});

	it("previews {{VDATE:name,format}}", async () => {
		const { text } = await preview("{{VDATE:dueDate, YYYY-MM-DD}}");
		expect(text).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it("previews {{FIELD:x}} as a value of that field", async () => {
		const { text } = await preview("{{FIELD:category}}");
		expect(text).toBe("category_field_value");
	});

	it("previews {{SELECTED}} and {{CLIPBOARD}} without reading either", async () => {
		const { text } = await preview("{{SELECTED}} {{CLIPBOARD}}");
		expect(text).toBe("selected_text clipboard_content");
	});

	it("previews {{RANDOM:n}}", async () => {
		const { text } = await preview("{{RANDOM:4}}");
		expect(text).toBe("ABC1");
	});

	it("previews {{FOLDERCURRENT}} as the active file's folder", async () => {
		const { text } = await preview("{{FOLDERCURRENT}}/Note");
		expect(text).toBe("test/Note");
	});

	it("previews {{FILENAMECURRENT}} as the active file's name", async () => {
		const { text } = await preview("Re {{FILENAMECURRENT}}");
		expect(text).toBe("Re example");
	});

	it("previews {{TIME}}", async () => {
		// The stub moment returns one string for every format, so this can only
		// assert that the pass RAN. What {{TIME}} really renders (HH:mm, colon
		// and all) is pinned with real moment in
		// fileNameDisplayFormatter-1578-illegal-chars.test.ts.
		const { text } = await preview("At {{TIME}}");
		expect(text).not.toContain("{{TIME}}");
	});

	it("previews {{FILE:folder}} as a file from that folder", async () => {
		const { text } = await preview("{{FILE:Templates}}");
		expect(text).toBe("Daily");
	});

	it("expands a {{GLOBAL_VAR:}} snippet", async () => {
		const { text } = await preview("{{GLOBAL_VAR:prefix}}Note");
		expect(text).toBe("Draft Note");
	});

	it("reads a {{TEMPLATE:}} body inertly", async () => {
		const { text, diagnostics } = await preview("{{TEMPLATE:Templates/Daily.md}}");
		expect(text).toBe("Daily body");
		expect(diagnostics).toEqual([]);
	});

	it("reports a missing {{TEMPLATE:}} as an error, because the run aborts", async () => {
		const { text, diagnostics } = await preview("{{TEMPLATE:missing.md}}");
		expect(text).toBe("[QuickAdd: template not found] missing.md");
		expect(diagnostics).toEqual([
			{ severity: "error", message: "Template not found: missing.md" },
		]);
	});

	it("leaves link tokens literal, as the run's formatFileName does", async () => {
		// `formatFileName` resolves {{filenamecurrent}}/{{folder}}/{{foldercurrent}}
		// but never the link tokens - a file name is not a place for a wikilink.
		const { text } = await preview("Related to {{LINKTOCURRENT}}");
		expect(text).toBe("Related to {{LINKTOCURRENT}}");
	});

	it("previews nothing for empty input", async () => {
		const { text, diagnostics } = await preview("");
		expect(text).toBe("");
		expect(diagnostics).toEqual([]);
	});

	it("echoes an unterminated token instead of throwing", async () => {
		const { text, diagnostics } = await preview("{{INVALID");
		expect(text).toBe("{{INVALID");
		expect(diagnostics).toEqual([]);
	});
});

describe("tokens the file-name preview resolves the way the run does", () => {
	it("previews {{MVALUE}} with the math stand-in, because the run prompts (#1587)", async () => {
		// The math token is `{{MVALUE}}` (MATH_VALUE_REGEX, constants.ts).
		// CompleteFormatter.format runs replaceMathValueInString and
		// formatFileName goes through format(), so the run really does open the
		// math modal here.
		const { text, diagnostics } = await preview("File {{MVALUE}}");
		expect(text).toBe("File calculation_result");
		expect(diagnostics).toEqual([]);
	});

	it("previews an already-collected {{MVALUE}} answer rather than the stand-in", async () => {
		// The one-page form and the CLI both collect this token under the key
		// "mvalue"; the preview reads it exactly as the run now does (#1607).
		const formatter = makeFormatter();
		(formatter as unknown as { variables: Map<string, unknown> }).variables.set(
			"mvalue",
			"2+2",
		);
		await expect(formatter.format("File {{MVALUE}}")).resolves.toBe("File 2+2");
	});
});

describe("tokens the file-name preview does NOT resolve today", () => {
	/**
	 * Pinned as CURRENT behaviour with the issue each is filed as, not as
	 * desired behaviour.
	 */
	it("leaves {{MATH:1+1}}, which is not a token at all, as plain text", async () => {
		// The mock this file replaced asserted `File calculation_result` for
		// this input, and #1580 was filed because nothing could contradict it.
		// `{{MATH:...}}` matches no regex in QuickAdd; the run puts the literal
		// text in the name, and Obsidian then refuses it over the colon - which
		// is pinned in fileNameDisplayFormatter-1578-illegal-chars.test.ts.
		const { text } = await preview("File {{MATH:1+1}}");
		expect(text).toBe("File {{MATH:1+1}}");
	});

});

describe("{{title}} in a file-name format (#1588)", () => {
	const CIRCULAR =
		"A file name cannot contain {{title}}, because the title is derived from the file name itself - so this choice would fail at run time.";

	it("reports an error, because formatFileName throws on it", async () => {
		// The token stays literal - the run resolves it to nothing here, and an
		// example title would be a name that can never exist - so the row keeps
		// saying "Unresolved:" and the diagnostic explains why it never will.
		const { text, diagnostics } = await preview("{{title}} note");
		expect(text).toBe("{{title}} note");
		expect(diagnostics).toEqual([{ severity: "error", message: CIRCULAR }]);
	});

	it("matches the run's case-insensitive check", async () => {
		const { diagnostics } = await preview("{{TITLE}} note");
		expect(diagnostics).toEqual([{ severity: "error", message: CIRCULAR }]);
	});

	it("catches a {{title}} produced by a global snippet, as the run's second check does", async () => {
		// formatFileName re-checks format()'s OUTPUT precisely because a
		// {{GLOBAL_VAR:}} snippet can smuggle the token in after the input check.
		const formatter = new FileNameDisplayFormatter(
			makeApp(),
			{
				settings: { globalVariables: { circular: "{{title}}" }, choices: [] },
				getTemplateFiles: () => [],
			} as unknown as QuickAdd,
		);
		formatter.setTargetFolderPath("Folder/Name");
		await formatter.format("{{GLOBAL_VAR:circular}} note");
		expect(formatter.diagnostics.list()).toEqual([
			{ severity: "error", message: CIRCULAR },
		]);
	});

	it("stays quiet for a {{title}} inside an included template body", async () => {
		// The run splices that body in through the child engine's
		// formatFileContent, which resolves {{title}} to the stored title (or "")
		// BEFORE formatFileName's check ever sees it - so the choice works, and
		// accusing it would be the cry-wolf this cluster exists to delete.
		const { text, diagnostics } = await preview(
			"{{TEMPLATE:Templates/Titled.md}}",
		);
		// The empty title leaves the space it was followed by, exactly as the run
		// does - the name normalizer only trims TRAILING spaces.
		expect(text).toBe(" note");
		expect(diagnostics).toEqual([]);
	});
});
