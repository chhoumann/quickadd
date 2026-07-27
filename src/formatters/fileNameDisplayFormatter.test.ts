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
			getMarkdownFiles: () => [],
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
	settings: { globalVariables: {}, choices: [] },
	getTemplateFiles: () => [],
} as unknown as QuickAdd;

function makeFormatter(): FileNameDisplayFormatter {
	return new FileNameDisplayFormatter(makeApp(), plugin);
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

describe("tokens the file-name preview does NOT resolve today", () => {
	/**
	 * Both pinned as CURRENT behaviour with an issue number, not as desired
	 * behaviour. The old mock in this file asserted the opposite for {{MATH:}}
	 * ("File calculation_result") - which is exactly the kind of claim a test
	 * that mocks itself can make forever without anyone noticing.
	 */
	it("leaves {{MATH:}} literal even though the run resolves it (#1587)", async () => {
		// CompleteFormatter.format runs replaceMathValueInString and
		// formatFileName goes through format(), so the run really does prompt
		// here. Neither display formatter has the pass, though both override
		// `promptForMathValue` with a stand-in that is therefore unreachable.
		const { text } = await preview("File {{MATH:1+1}}");
		expect(text).toBe("File {{MATH:1+1}}");
	});

	it("leaves {{title}} literal even though the run throws on it (#1588)", async () => {
		// formatFileName rejects {{title}} in a file name outright
		// ("circular dependency"), so this format string can never create a note.
		const { text, diagnostics } = await preview("{{title}} note");
		expect(text).toBe("{{title}} note");
		expect(diagnostics).toEqual([]);
	});
});
