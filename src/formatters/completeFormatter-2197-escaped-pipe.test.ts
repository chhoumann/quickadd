import { describe, expect, it } from "vitest";
import { TFile } from "obsidian";
import type { App } from "obsidian";
import type QuickAdd from "../main";
import type { PromptContext } from "./formatter";
import { FILE_PICK_PREFIX, type ParsedFileToken } from "../utils/fileSyntax";
import {
	FieldSuggestionParser,
	type FieldFilter,
} from "../utils/FieldSuggestionParser";
import { CompleteFormatter } from "./completeFormatter";

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
const app = {
	workspace: { getActiveFile: () => null, getActiveViewOfType: () => null },
	vault: { getAbstractFileByPath: (p: string) => (p === ann.path ? ann : null) },
	fileManager: {
		generateMarkdownLink: (file: TFile) => `[[${file.basename}]]`,
	},
} as unknown as App;

class RecordingFormatter extends CompleteFormatter {
	files: ParsedFileToken[] = [];
	fields: { fieldName: string; filters: FieldFilter }[] = [];
	variablePrompts: { name?: string; context?: PromptContext }[] = [];
	valueLabels: (string | undefined)[] = [];
	macros: { name: string; context?: { label?: string } }[] = [];
	answer = "answer";

	constructor(globalVariables: Record<string, string> = {}) {
		super(app, {
			settings: { globalVariables, inputPrompt: "single-line", choices: [] },
		} as unknown as QuickAdd);
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
		return "macro output";
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
});
