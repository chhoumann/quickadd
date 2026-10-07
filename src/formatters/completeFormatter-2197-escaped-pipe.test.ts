import { describe, expect, it } from "vitest";
import realMoment from "moment";
import { TFile } from "obsidian";
import type { App } from "obsidian";
import type QuickAdd from "../main";
import type { PromptContext } from "./formatter";
import {
	FILE_PICK_PREFIX,
	parseFileToken,
	type ParsedFileToken,
} from "../utils/fileSyntax";
import {
	FieldSuggestionParser,
	type FieldFilter,
} from "../utils/FieldSuggestionParser";
import { CompleteFormatter } from "./completeFormatter";
import { RequirementCollector } from "../preflight/RequirementCollector";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { createChoiceExecutor } from "../../tests/helpers/createChoiceExecutor";

/**
 * Issue #2197. A Markdown table cell needs its pipe written `\|`, so a token
 * with a pipe option can only appear in a table as `{{FILE:Persons\|label:x}}`.
 * Every token grammar must read that pipe as `|`; text outside tokens and
 * every substituted value keep theirs.
 */

function makeFile(path: string): TFile {
	const name = path.split("/").pop() ?? path;
	return Object.assign(new TFile(), {
		path,
		name,
		basename: name.replace(/\.md$/, ""),
		extension: "md",
		parent: { path: path.slice(0, path.lastIndexOf("/")) },
	});
}

const ann = makeFile("Persons/Ann.md");
const files = new Map(
	[ann, makeFile("Templates/Note.md"), makeFile("Include.md")].map((file) => [
		file.path,
		file,
	]),
);
const app = {
	workspace: { getActiveFile: () => null, getActiveViewOfType: () => null },
	vault: {
		getAbstractFileByPath: (p: string) => files.get(p) ?? null,
		cachedRead: async () => "{{VALUE:due}}",
		getFiles: () => [...files.values()],
		getMarkdownFiles: () => [...files.values()],
	},
	plugins: { plugins: {} },
	metadataCache: { getFileCache: () => null, getAllPropertyInfos: () => ({}) },
	fileManager: {
		generateMarkdownLink: (file: TFile) => `[[${file.basename}]]`,
	},
} as unknown as App;

const makePlugin = (globalVariables: Record<string, string> = {}) =>
	({
		settings: { globalVariables, inputPrompt: "single-line", choices: [] },
	}) as unknown as QuickAdd;

class RecordingFormatter extends CompleteFormatter {
	files: ParsedFileToken[] = [];
	fields: { fieldName: string; filters: FieldFilter }[] = [];
	variablePrompts: { name?: string; context?: PromptContext }[] = [];
	valueLabels: (string | undefined)[] = [];
	macros: { name: string; context?: { label?: string } }[] = [];
	answer = "answer";
	macroOutput = "macro output";

	constructor(globalVariables: Record<string, string> = {}) {
		super(app, makePlugin(globalVariables));
	}

	protected async suggestForFile(parsed: ParsedFileToken): Promise<string> {
		this.files.push(parsed);
		return `${FILE_PICK_PREFIX}${ann.path}`;
	}

	protected async suggestForField(specifier: string): Promise<string> {
		const { fieldName, filters } = FieldSuggestionParser.parse(specifier);
		this.fields.push({ fieldName, filters });
		return "done";
	}

	protected async promptForVariable(
		name?: string,
		context?: PromptContext,
	): Promise<string> {
		this.variablePrompts.push({ name, context });
		return context?.type === "VDATE" ? "" : this.answer;
	}

	protected async promptForValue(): Promise<string> {
		this.valueLabels.push(this.valuePromptContext?.label);
		return this.answer;
	}

	protected async getMacroValue(
		name: string,
		context?: { label?: string },
	): Promise<string> {
		this.macros.push({ name, context });
		return this.macroOutput;
	}
}

describe("#2197 escaped pipes inside tokens in a table cell", () => {
	it("hands the FILE picker the folder and label of a table cell token", async () => {
		const f = new RecordingFormatter();
		const out = await f.formatFileContent(
			"| {{FILE:Persons\\|label:Prompt Three}} |",
		);

		expect(f.files).toHaveLength(1);
		expect(f.files[0].folderPath).toBe("Persons");
		expect(f.files[0].label).toBe("Prompt Three");
		expect(out).toBe("| Ann |");
	});

	it("hands the FIELD suggester the field name and folder filter", async () => {
		const f = new RecordingFormatter();
		await f.formatFileContent("| {{FIELD:status\\|folder:Work}} |");

		expect(f.fields).toHaveLength(1);
		expect(f.fields[0].fieldName).toBe("status");
		expect(f.fields[0].filters.folder).toBe("Work");
	});

	it("reads the VDATE format and options of a table cell token", async () => {
		const f = new RecordingFormatter();
		await f.formatFileContent("| {{VDATE:due,YYYY-MM-DD\\|optional}} |");

		expect(f.variablePrompts).toHaveLength(1);
		expect(f.variablePrompts[0].name).toBe("due");
		expect(f.variablePrompts[0].context).toMatchObject({
			type: "VDATE",
			dateFormat: "YYYY-MM-DD",
			optional: true,
		});
	});

	it("passes a MACRO its label", async () => {
		const f = new RecordingFormatter();
		await f.formatFileContent("| {{MACRO:m\\|label:L}} |");

		expect(f.macros).toEqual([{ name: "m", context: { label: "L" } }]);
	});

	it("titles an anonymous VALUE prompt with its label", async () => {
		const f = new RecordingFormatter();
		await f.formatFileContent("| {{VALUE\\|label:Who}} |");

		expect(f.valueLabels).toEqual(["Who"]);
	});

	it("reads a token inside a global snippet that holds a table row", async () => {
		const f = new RecordingFormatter({ row: "| {{FILE:Persons\\|link}} |" });
		const out = await f.formatFileContent("{{GLOBAL_VAR:row}}");

		expect(f.files).toHaveLength(1);
		expect(f.files[0].folderPath).toBe("Persons");
		expect(f.files[0].mode).toBe("link");
		expect(out).toBe("| [[Ann]] |");
	});

	it("writes an answer holding an escaped pipe verbatim", async () => {
		const f = new RecordingFormatter();
		f.answer = "x\\|y";
		const out = await f.formatFileContent("| {{VALUE:who}} | {{VALUE}} |");

		expect(out).toBe("| x\\|y | x\\|y |");
	});

	it("keeps escaped pipes outside tokens", async () => {
		const f = new RecordingFormatter();
		const out = await f.formatFileContent(
			"| a \\| b | {{VALUE:who\\|default:z}} |",
		);

		expect(out).toBe("| a \\| b | answer |");
		expect(f.variablePrompts[0].name).toBe("who");
	});

	it("writes an inline script's escaped pipe verbatim", async () => {
		const f = new CompleteFormatter(app, makePlugin(), createChoiceExecutor());
		const out = await f.formatFileContent(
			'```js quickadd\nreturn "{{LITERAL:a\\\\|b}}";\n```',
		);

		expect(out).toBe("{{LITERAL:a\\|b}}");
	});

	it("writes a macro's escaped pipe verbatim", async () => {
		const f = new RecordingFormatter();
		f.macroOutput = "{{LITERAL:a\\|b}}";
		const out = await f.formatFileContent("{{MACRO:m}}");

		expect(out).toBe("{{LITERAL:a\\|b}}");
	});

	it("resolves a template path from a global the way preflight does", async () => {
		const globals = { source: "{{FILE:Templates\\|path}}" };
		const collector = new RequirementCollector(app, makePlugin(globals));
		await collector.scanString("{{GLOBAL_VAR:source}}", true, "templatePath");
		const key = parseFileToken("Templates|path")!.variableKey;
		expect(collector.requirements.get(key)?.options).toEqual([
			`${FILE_PICK_PREFIX}Templates/Note.md`,
		]);

		const executor = createChoiceExecutor();
		executor.interactive = false;
		executor.variables.set(key, `${FILE_PICK_PREFIX}Templates/Note.md`);
		const f = new CompleteFormatter(app, makePlugin(globals), executor);

		await expect(f.formatTemplateFilePath("{{GLOBAL_VAR:source}}")).resolves.toBe(
			"Templates/Note.md",
		);
	});

	it("reads an escaped pipe typed into a template path", async () => {
		const executor = createChoiceExecutor();
		executor.interactive = false;
		executor.variables.set(
			parseFileToken("Templates|path")!.variableKey,
			`${FILE_PICK_PREFIX}Templates/Note.md`,
		);
		const f = new CompleteFormatter(app, makePlugin(), executor);

		await expect(
			f.formatTemplateFilePath("{{FILE:Templates\\|path}}"),
		).resolves.toBe("Templates/Note.md");
	});

	it("asks a date for an include reusing a global's VDATE", async () => {
		const prompts: string[] = [];
		const executor = createChoiceExecutor();
		executor.promptProvider = {
			inputPrompt: async () => {
				prompts.push("input");
				return "not a date";
			},
			datePrompt: async () => {
				prompts.push("date");
				return "@date:2026-10-07T00:00:00.000Z";
			},
		} as unknown as IChoiceExecutor["promptProvider"];
		const f = new CompleteFormatter(
			app,
			makePlugin({ row: "| {{VDATE:due\\|optional}} |" }),
			executor,
		);
		const stubMoment = window.moment;
		window.moment = ((input?: string) => realMoment.utc(input)) as never;
		let out: string;
		try {
			out = await f.formatFileContent(
				"{{TEMPLATE:Include.md}}\n{{GLOBAL_VAR:row}}",
			);
		} finally {
			window.moment = stubMoment;
		}

		expect(prompts).toEqual(["date"]);
		expect(out).toBe("2026-10-07\n| 2026-10-07 |");
	});
});
