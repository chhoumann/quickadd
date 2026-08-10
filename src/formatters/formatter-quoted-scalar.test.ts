import { describe, it, expect, beforeEach } from "vitest";
import { Formatter } from "./formatter";
import { FIELD_VARIABLE_PREFIX } from "../constants";

// Issue #1655: authors quote tokens in template front matter so the raw
// template is valid YAML (Obsidian warns on bare `{{...}}`). The substituted
// value must then be escaped for the surrounding quotes, or a value containing
// the quote character corrupts the created note's front matter.
class QuotedScalarTestFormatter extends Formatter {
	constructor() {
		super();
	}

	protected async format(input: string): Promise<string> {
		let output = input;
		output = await this.replaceValueInString(output);
		output = await this.replaceVariableInString(output);
		output = await this.replaceFieldVarInString(output);
		return output;
	}

	protected promptForValue(): string {
		return this.anonymousValue;
	}

	public anonymousValue = "";

	protected getCurrentFileLink(): string | null {
		return null;
	}

	protected getCurrentFileName(): string | null {
		return null;
	}

	protected getVariableValue(variableName: string): string {
		return (this.variables.get(variableName) as string) ?? "";
	}

	protected suggestForValue(
		_suggestedValues: string[],
		_allowCustomInput?: boolean,
		_context?: { placeholder?: string; variableKey?: string },
	): string {
		return "";
	}

	protected suggestForFile(): string {
		return "";
	}

	protected suggestForField(_variableName: string): Promise<string> {
		return Promise.resolve("");
	}

	protected promptForMathValue(): Promise<string> {
		return Promise.resolve("");
	}

	protected getMacroValue(
		_macroName: string,
		_context?: { label?: string },
	): string {
		return "";
	}

	protected promptForVariable(
		_variableName: string,
		_context?: {
			type?: string;
			dateFormat?: string;
			defaultValue?: string;
			label?: string;
			description?: string;
			placeholder?: string;
			variableKey?: string;
		},
	): Promise<string> {
		return Promise.resolve("");
	}

	protected getTemplateContent(_templatePath: string): Promise<string> {
		return Promise.resolve("");
	}

	protected getSelectedText(): Promise<string> {
		return Promise.resolve("");
	}

	protected getClipboardContent(): Promise<string> {
		return Promise.resolve("");
	}

	protected isTemplatePropertyTypesEnabled(): boolean {
		return false;
	}

	public async testFormat(input: string): Promise<string> {
		return await this.format(input);
	}

	public seed(key: string, value: unknown): void {
		this.variables.set(key, value);
	}
}

describe("issue #1655: values substituted into author-quoted front matter scalars", () => {
	let formatter: QuotedScalarTestFormatter;

	beforeEach(() => {
		formatter = new QuotedScalarTestFormatter();
	});

	it("escapes double quotes in a VALUE inside a double-quoted scalar", async () => {
		formatter.seed("fileName", 'My "Great" Note');
		const result = await formatter.testFormat(
			'---\nTitle: "{{VALUE:fileName}}"\n---\nBody',
		);
		expect(result).toBe('---\nTitle: "My \\"Great\\" Note"\n---\nBody');
	});

	it("doubles apostrophes in a VALUE inside a single-quoted scalar", async () => {
		formatter.seed("who", "O'Brien");
		const result = await formatter.testFormat(
			"---\nauthor: '{{VALUE:who}}'\n---\nBody",
		);
		expect(result).toBe("---\nauthor: 'O''Brien'\n---\nBody");
	});

	it("escapes a FIELD value inside a double-quoted scalar", async () => {
		formatter.seed(`${FIELD_VARIABLE_PREFIX}status`, 'in "review"');
		const result = await formatter.testFormat(
			'---\nstatus: "{{FIELD:status}}"\n---\nBody',
		);
		expect(result).toBe('---\nstatus: "in \\"review\\""\n---\nBody');
	});

	it("leaves unquoted substitutions untouched", async () => {
		formatter.seed("fileName", 'My "Great" Note');
		const result = await formatter.testFormat(
			"---\nTitle: {{VALUE:fileName}}\n---\nBody",
		);
		expect(result).toBe('---\nTitle: My "Great" Note\n---\nBody');
	});

	it("escapes the anonymous {{VALUE}} inside a double-quoted scalar", async () => {
		formatter.anonymousValue = 'he said "hi"';
		const result = await formatter.testFormat(
			'---\ntitle: "{{VALUE}}"\n---\nBody',
		);
		expect(result).toBe('---\ntitle: "he said \\"hi\\""\n---\nBody');
	});

	it("escapes the anonymous {{NAME}} form the same way", async () => {
		formatter.anonymousValue = 'he said "hi"';
		const result = await formatter.testFormat(
			'---\ntitle: "{{NAME}}"\n---\nBody',
		);
		expect(result).toBe('---\ntitle: "he said \\"hi\\""\n---\nBody');
	});

	it("escapes a joined multi-select FIELD fallback inside a quoted scalar", async () => {
		formatter.seed(`${FIELD_VARIABLE_PREFIX}tags|multi`, ['say "hi"', "b"]);
		const result = await formatter.testFormat(
			'---\ntags: "{{FIELD:tags|multi}}"\n---\nBody',
		);
		expect(result).toBe('---\ntags: "say \\"hi\\",b"\n---\nBody');
	});

	it("consumes author quotes when an explicit |type:number is declared", async () => {
		formatter.seed("num", "42");
		const result = await formatter.testFormat(
			'---\nrating: "{{VALUE:num|type:number}}"\n---\nBody',
		);
		expect(result).toBe("---\nrating: 42\n---\nBody");
	});

	it("consumes author quotes for |type:checkbox", async () => {
		formatter.seed("d", "true");
		const result = await formatter.testFormat(
			'---\ndone: "{{VALUE:d|type:checkbox}}"\n---\nBody',
		);
		expect(result).toBe("---\ndone: true\n---\nBody");
	});

	it("keeps quotes for |type:text (string semantics)", async () => {
		formatter.seed("id", "0042");
		const result = await formatter.testFormat(
			'---\nid: "{{VALUE:id|type:text}}"\n---\nBody',
		);
		expect(result).toBe('---\nid: "0042"\n---\nBody');
	});

	it("keeps quotes and escapes for |type:multiline", async () => {
		formatter.seed("n", "a\nb");
		const result = await formatter.testFormat(
			'---\nnotes: "{{VALUE:n|type:multiline}}"\n---\nBody',
		);
		expect(result).toBe('---\nnotes: "a\\nb"\n---\nBody');
	});

	it("does not consume quotes in the note body", async () => {
		formatter.seed("num", "42");
		const result = await formatter.testFormat(
			'---\nTitle: x\n---\nSaid "{{VALUE:num|type:number}}" today',
		);
		expect(result).toBe('---\nTitle: x\n---\nSaid "42" today');
	});

	it("leaves body substitutions untouched even when the author wrote quotes", async () => {
		formatter.seed("quote", 'she said "hi"');
		const result = await formatter.testFormat(
			'---\nTitle: x\n---\nThey wrote "{{VALUE:quote}}" today',
		);
		expect(result).toBe(
			'---\nTitle: x\n---\nThey wrote "she said "hi"" today',
		);
	});
});
