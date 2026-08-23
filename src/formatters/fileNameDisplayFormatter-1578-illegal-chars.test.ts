import realMoment from "moment";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import type { App } from "obsidian";
import { TFile, TFolder } from "obsidian";
import { FileNameDisplayFormatter } from "./fileNameDisplayFormatter";
import type QuickAdd from "../main";

/**
 * Issue #1578. The file-name preview used to present names Obsidian refuses:
 * `Bad: {{VALUE:title}}` previewed `Bad: Example Title` in the ordinary
 * "Preview:" styling, and running the choice created nothing.
 *
 * MEASURED against `vault.create` / `vault.createFolder` on Obsidian 1.13.0
 * (macOS, isolated e2e vault), one candidate character per name: `:` throws
 * Obsidian's own "File name cannot contain any of the following characters:
 * \ / :" for files AND folder segments; `* ? " < > | ^ [ ] #` and tab all create
 * successfully; `\` and `/` are separators (QuickAdd creates the parent folder).
 * So the rule is `:` and only `:`.
 *
 * The check reads the FINISHED name rather than the format string, because that
 * is the only place all the sources meet - typed text, `{{TIME}}`, a global
 * snippet, an included template body, and the literal text left behind by a
 * token that never matched. That only works if the preview's own stand-ins stay
 * name-shaped, which is what the "does not invent" block below pins.
 *
 * Real moment + a frozen clock: the obsidian-stub moment returns the same string
 * for every format (tests/obsidian-stub.ts), so `{{TIME}}` and `{{DATE:HH:mm}}`
 * would produce no colon at all and every date case here would pass vacuously.
 * A LOCAL-time literal, not a `Z` instant, or `HH:mm` becomes TZ-dependent.
 */
const originalMoment = (window as unknown as { moment?: unknown }).moment;
const previousLocale = realMoment.locale();

beforeAll(() => {
	realMoment.locale("en");
	(window as unknown as { moment: unknown }).moment = realMoment;
});
afterAll(() => {
	(window as unknown as { moment?: unknown }).moment = originalMoment;
	realMoment.locale(previousLocale);
	vi.useRealTimers();
});
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2023-06-01T14:30:05"));
	templates = {};
	globalVariables = {};
	existingFiles = new Set();
	existingFolders = new Set();
});

let templates: Record<string, string> = {};
let globalVariables: Record<string, string> = {};
let existingFiles = new Set<string>();
let existingFolders = new Set<string>();

function makeApp(): App {
	return {
		workspace: {
			getActiveFile: () => ({
				basename: "example",
				path: "test/example.md",
				parent: { path: "test" },
			}),
		},
		vault: {
			getMarkdownFiles: () => [],
			getAbstractFileByPath: (path: string) => {
				// Obsidian's path map holds files AND folders, with no trailing
				// slash on either, which is what the shape-aware probe turns on.
				if (existingFolders.has(path)) {
					return Object.assign(new TFolder(), { path, children: [] });
				}
				return path in templates || existingFiles.has(path)
					? Object.assign(new TFile(), {
							path,
							extension: "md",
							basename: path.replace(/\.md$/, ""),
						})
					: null;
			},
			cachedRead: async (file: { path: string }) => templates[file.path],
		},
		metadataCache: { getFileCache: () => null, getAllPropertyInfos: () => ({}) },
	} as unknown as App;
}

function makeFormatter(): FileNameDisplayFormatter {
	const formatter = new FileNameDisplayFormatter(makeApp(), {
		settings: { globalVariables, choices: [] },
		getTemplateFiles: () => [],
	} as unknown as QuickAdd);
	// Every real caller sets this (FormatPreviewField passes the choice's folder,
	// or a "Folder/Name" placeholder), and leaving it unset makes {{FOLDER}}
	// collapse to an empty segment.
	formatter.setTargetFolderPath("Folder/Name");
	return formatter;
}

async function preview(input: string) {
	const formatter = makeFormatter();
	const text = await formatter.format(input);
	return { text, diagnostics: formatter.diagnostics.list() };
}

/**
 * One sentence, naming both places the character can come from. An earlier draft
 * split it on "is the colon anywhere in the format string", which sounds right
 * and is not: every argument-bearing token carries a colon in its own syntax, so
 * `{{DATE:YYYY-MM-DD}} {{TIME}}` - where the hint is needed most - would be told
 * the author can see it.
 */
const REFUSED =
	'A file or folder name cannot contain ":", so this choice would fail at run time. Check your own text and tokens like {{TIME}}, which is HH:mm.';

describe("the file-name preview says when Obsidian will refuse the name", () => {
	it("flags the colon the author typed - the reported case", async () => {
		const { text, diagnostics } = await preview("Bad: {{VALUE:title}}");
		// Still shows the best-effort name: the diagnostic is what says it is
		// unusable, and blanking the row would hide the shape of the mistake.
		expect(text).toBe("Bad: Example Title");
		expect(diagnostics).toEqual([{ severity: "error", kind: "path", message: REFUSED }]);
	});

	it("flags a colon in a folder segment, which Obsidian refuses too", async () => {
		const { diagnostics } = await preview("Bad: folder/{{VALUE:title}}");
		expect(diagnostics).toEqual([{ severity: "error", kind: "path", message: REFUSED }]);
	});

	it("flags {{TIME}}, which is HH:mm and which the author never typed", async () => {
		const { text, diagnostics } = await preview("Meeting {{TIME}}");
		expect(text).toBe("Meeting 14:30");
		expect(diagnostics).toEqual([{ severity: "error", kind: "path", message: REFUSED }]);
	});

	it("flags a time format inside {{DATE:}}", async () => {
		const { text, diagnostics } = await preview("Log {{DATE:HH:mm}}");
		expect(text).toBe("Log 14:30");
		expect(diagnostics).toEqual([{ severity: "error", kind: "path", message: REFUSED }]);
	});

	it("flags a colon a global snippet brought in", async () => {
		globalVariables = { prefix: "Meeting: " };
		const { text, diagnostics } = await preview(
			"{{GLOBAL_VAR:prefix}}{{VALUE:title}}",
		);
		expect(text).toBe("Meeting: Example Title");
		expect(diagnostics).toEqual([{ severity: "error", kind: "path", message: REFUSED }]);
	});

	it("flags a colon an included template body brought in", async () => {
		templates["Naming.md"] = "Meeting: notes\n";
		const { text, diagnostics } = await preview("{{TEMPLATE:Naming.md}}");
		expect(text).toBe("Meeting: notes");
		expect(diagnostics).toEqual([{ severity: "error", kind: "path", message: REFUSED }]);
	});

	it("flags a token that never matched and went to the vault verbatim", async () => {
		// TEMPLATE_REGEX requires .md/.canvas/.base, so this is not a token at
		// all - the literal text is the file name. A rule that masked
		// `{{...}}`-shaped spans would be silent on the single most likely
		// {{TEMPLATE:}} typo.
		const { text, diagnostics } = await preview("{{TEMPLATE:Naming}}");
		expect(text).toBe("{{TEMPLATE:Naming}}");
		expect(diagnostics).toEqual([{ severity: "error", kind: "path", message: REFUSED }]);
	});
});

describe("the file-name preview does not cry wolf", () => {
	it("stays quiet on a name that is fine", async () => {
		const { text, diagnostics } = await preview(
			"{{DATE:YYYY-MM-DD}} {{VALUE:title}}",
		);
		expect(text).toBe("2023-06-01 Example Title");
		expect(diagnostics).toEqual([]);
	});

	it("stays quiet mid-token, while the format suggester is open", async () => {
		// `Notes/{{DATE:` is exactly what the field holds for as long as someone
		// reads the popup this prefix opens, and the diagnostics row appears after
		// 500ms of stillness - so without the guard, pausing to read the popup
		// turns the row red.
		const { text, diagnostics } = await preview("Notes/{{DATE:");
		expect(text).toBe("Notes/{{DATE:");
		expect(diagnostics).toEqual([]);
	});

	it("stays quiet mid-SCRIPT, before the closing backticks are typed", async () => {
		// Until the fence closes there is no span to strip, so the half-written
		// JavaScript is read as part of the name. Without the guard, every pause
		// while typing `{a: 1}` or a "HH:mm" literal turns the row red.
		const { diagnostics } = await preview('```js quickadd\nreturn "a: b";');
		expect(diagnostics).toEqual([]);
	});

	it("stays quiet about punctuation inside an inline script fence", async () => {
		// The run replaces the fence with what the script RETURNS; the preview
		// leaves the source verbatim because it must not execute anything (#1558).
		// So the source's colons are never in the created name.
		const { diagnostics } = await preview(
			'```js quickadd\nconst a = {b: 1};\nreturn "Name";\n```',
		);
		expect(diagnostics).toEqual([]);
	});

	it("does not pile on when the pass already failed", async () => {
		// All four of this formatter's own placeholders are bracketed
		// `[QuickAdd: ...]` strings with a colon in them, and each already reported
		// the real problem.
		const { diagnostics } = await preview("{{TEMPLATE:missing.md}}");
		expect(diagnostics).toEqual([
			{ severity: "error", message: "Template not found: missing.md" },
		]);
	});

	it("stays quiet when the file is already there", async () => {
		// `:` is legal on macOS/Linux at the filesystem level, so a note made
		// outside Obsidian can carry one. A capture pointed at it appends
		// (CaptureChoiceEngine takes the fileExists branch and never reaches
		// vault.create), so nothing asks Obsidian to accept the name.
		existingFiles.add("Notes/a:b.md");
		const { diagnostics } = await preview("Notes/a:b.md");
		expect(diagnostics).toEqual([]);
	});

	it("tolerates the missing extension a file-name format leaves off", async () => {
		// The engine appends `.md` (normalizeMarkdownFilePath), so the preview's
		// name and the file on disk differ by the extension.
		existingFiles.add("Notes/a:b.md");
		const { diagnostics } = await preview("Notes/a:b");
		expect(diagnostics).toEqual([]);
	});

	it("stays quiet for a folder-shaped capture target whose folder exists", async () => {
		// A capture target written with a trailing slash names a FOLDER to pick
		// inside, and the folder being there is exactly what makes it work.
		// Obsidian's path map holds no trailing slash, so a bare lookup missed it
		// and the row went red for a capture that runs fine.
		existingFolders.add("Meetings: 2026");
		const { diagnostics } = await preview("Meetings: 2026/");
		expect(diagnostics).toEqual([]);
	});

	it("stays quiet for a BARE name that resolves to an existing folder scope", async () => {
		// captureTargetResolution: an existing folder with no real note beside it
		// is a folder SCOPE, and the capture picks a file inside it - so nothing
		// asks Obsidian to accept this string as a name. Reddening it would mark a
		// working capture broken, and would contradict the trailing-slash case
		// above for the same runtime target.
		existingFolders.add("Meetings: 2026");
		const { diagnostics } = await preview("Meetings: 2026");
		expect(diagnostics).toEqual([]);
	});

	it("still reports a colon when a FOLDER is merely named like the note", async () => {
		// A folder called `Meetings: 2026.md` is not a note, so it cannot be the
		// target of a capture and cannot excuse the name either.
		existingFolders.add("Meetings: 2026.md");
		const { diagnostics } = await preview("Meetings: 2026");
		expect(diagnostics).toEqual([
			{ severity: "error", kind: "path", message: REFUSED },
		]);
	});

	it("still reports a colon when the trailing-slash folder does not exist", async () => {
		const { diagnostics } = await preview("Meetings: 2026/");
		expect(diagnostics).toEqual([
			{ severity: "error", kind: "path", message: REFUSED },
		]);
	});

	it("still reports a colon when no such file exists", async () => {
		const { diagnostics } = await preview("Notes/a:b.md");
		expect(diagnostics).toEqual([{ severity: "error", kind: "path", message: REFUSED }]);
	});

	it("does not invent a colon out of a prompt header", async () => {
		// The run prompts with this header and splices in the ANSWER, so a colon
		// in the header is never in the name. The stand-in degrades to the
		// generic one rather than accusing the author.
		const { text, diagnostics } = await preview("{{VALUE:Cost: USD}}");
		expect(text).toBe("user input");
		expect(diagnostics).toEqual([]);
	});

	it("does not invent a colon out of a macro name", async () => {
		const { text, diagnostics } = await preview("{{MACRO:my:macro}}");
		expect(text).toBe("macro_output");
		expect(diagnostics).toEqual([]);
	});

	it("does not invent a colon out of a field name", async () => {
		const { text, diagnostics } = await preview("{{FIELD:a:b}}");
		expect(text).toBe("field_value");
		expect(diagnostics).toEqual([]);
	});

	it("does not invent a colon out of a VDATE default hint", async () => {
		// The hint used to be appended to the NAME: `2023-06-01 (default: tomorrow)`.
		const { text, diagnostics } = await preview(
			"{{VDATE:due,YYYY-MM-DD|tomorrow}}",
		);
		expect(text).toBe("2023-06-01");
		expect(diagnostics).toEqual([]);
	});

	it("applies case transforms to the VDATE file-name preview", async () => {
		const { text, diagnostics } = await preview(
			"{{VDATE:due,dddd, MMMM Do|case:lower}}",
		);
		expect(text).toBe("thursday, june 1st");
		expect(diagnostics).toEqual([]);
	});

	it("does not invent an option count", async () => {
		// The body preview says `Meeting (2 options)`; the run splices in the
		// option that gets picked and nothing else.
		const { text, diagnostics } = await preview("{{VALUE:Meeting,Note}}");
		expect(text).toBe("Meeting");
		expect(diagnostics).toEqual([]);
	});

	it("still reports an inline option that could not be a file name", async () => {
		// Not invention: an inline option is literal text that becomes the whole
		// name if it is the one picked, and then it cannot be created.
		const { text, diagnostics } = await preview("{{VALUE:Meeting: standup,Note}}");
		expect(text).toBe("Meeting: standup");
		expect(diagnostics).toEqual([{ severity: "error", kind: "path", message: REFUSED }]);
	});
});
